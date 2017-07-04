//  node --max-old-space-size=8192 mmjson_manager.js

var vm = require("vm");
var fs = require("fs");
var zlib = require('zlib');
var cluster = require('cluster');
var Transform = require('stream').Transform;
var stream = require('stream');
var DOMParser = require("xmldom").DOMParser; // npm install -g xmldom
var yaml = require('js-yaml');

var child_process = require("child_process");

module.exports = function(path, context) {
  var data = fs.readFileSync(path);
  vm.runInNewContext(data, context, path);
  return context;
}

// load CIF parser
var CIF = module.exports("./cif.js", {});
CIF.loadCIFdic(require("./mmcif_pdbx_v50_summary.json"));
//loadPDBMLdic <-- not implemented yet...


// read settings
var config = yaml.safeLoad(fs.readFileSync('config.yml', 'utf8'));

var root = config.root;

var mmcif_loc_pre = config.mmcif_loc_pre; // array
var mmcif_loc = config.mmcif_loc; // array

var add_loc_pre = config.add_loc_pre; // array
var add_loc = config.add_loc; // array

var obsolete_loc_pre = config.obsolete_loc_pre; // array
var obsolete_loc = config.obsolete_loc; // array

var build = false;
var sync = false;

var altName = "";
var saveTarget = root+"/mmjson-pre"+altName+"/";

var cifList = [], plusList = [];


// helper code to write large entries (they cannot be saved using regular JSON.stringify)
function writeStr2Stream(str, stream) {
  stream.push(str);
}

function writeArray2Stream(array, stream) {
  stream.push(JSON.stringify(array));
}

function hugeMMJSONsave(k, jso, stream, done) {
  setImmediate(writeStr2Stream, '{"'+k+'":{', stream);
  var cat, dn;
  
  var cats = Object.keys(jso), dataNames;
  
  for (var c=0, dn; c<cats.length; c++) {
    setImmediate(writeStr2Stream, (c ? ',' : '')+'"'+cats[c]+'":{', stream);
    cat = jso[cats[c]];
    dataNames = Object.keys(cat);
    for (dn=0; dn<dataNames.length; dn++) {
      setImmediate(writeStr2Stream, (dn ? ',' : '')+'"'+dataNames[dn]+'":', stream);
      setImmediate(writeArray2Stream, cat[dataNames[dn]], stream);
    }
    setImmediate(writeStr2Stream, '}', stream);
  }
  setImmediate(writeStr2Stream, '}}', stream);
  setImmediate(done);
}


// process a CIF file
function handleCIF(loc) {
  if (! loc) return getJob();
  var pdbid = loc.substr(loc.length-11, 4);
  //console.log("Processing "+pdbid);

  var stats = fs.statSync(loc);

  // helper code to read in the CIF data
  var buffer = "";
  var accumulate = new Transform();
  accumulate._transform = function(data, encoding, done) {
    buffer += data.toString();
    process.nextTick(done);
  };
  accumulate._flush = function(done) {
    this.push(buffer);
    process.nextTick(done);
  };
  
  // helper code to parse the CIF data and output the JSON data
  var cifHandler = new Transform(), jso;
  cifHandler._transform = function(data, encoding, done) {
    var tmp = data.toString();
    jso = CIF.loadCIF(tmp); // load CIF
    if (tmp.length < 128e6) { // save regular sized files as mmJSON
      this.push(JSON.stringify(jso)); // less than 128MB should be OK?
      process.nextTick(done);
    }
    else { // save large files as mmJSON
      var k = "data_"+pdbid.toUpperCase();
      hugeMMJSONsave(k, jso[k], this, done);
    }
  };
  
  var finalize = new Transform(); finalize._transform = function(data, encoding, done) {};
  finalize._flush = function(done) {process.nextTick(getJob);};
  
  fs.createReadStream(loc) // read file
    .pipe(zlib.createGunzip()) // unzip file
    .pipe(accumulate) // accumulate blocks of the file in a buffer
    .pipe(cifHandler) // CIF --> JSON
    .pipe(zlib.createGzip()) // gzip compression
    .pipe(fs.createWriteStream(saveTarget+"all/"+pdbid+".json.gz")) // save the file
    .on("close", function() { // onclose
      // remove atom information
      delete jso["data_"+pdbid.toUpperCase()]["atom_site"];
      delete jso["data_"+pdbid.toUpperCase()]["atom_site_anisotrop"];
      
      // save noatom mmJSON file
      var rs = new stream.Readable(); rs.push(JSON.stringify(jso)); rs.push(null);
      rs.pipe(zlib.createGzip()).pipe(fs.createWriteStream(saveTarget+"noatom/"+pdbid+"-noatom.json.gz"))
      .on("close", function() {fs.utimesSync(saveTarget+"noatom/"+pdbid+"-noatom.json.gz", stats.mtime, stats.mtime);});
    
      // set mtime for all & noatom files
      fs.utimesSync(saveTarget+"all/"+pdbid+".json.gz", stats.mtime, stats.mtime);

      // handle PDBj's annotation (plus) data
      handlePLUS_getPLUS(pdbid, jso, stats.mtime); 
    }) // also register a new job for add data here...
    ;
};

// this function is for plus data only modified entries (when the original CIF data has not been modified, but the plus data has)
function handlePLUS_getNOATOM(pdbid, mtime) {
  //console.log("Updating "+pdbid+"+");
  var loc = saveTarget+"noatom/"+pdbid+"-noatom.json.gz";
  
  var buffer = "";
  var accumulate = new Transform();
  accumulate._transform = function(data, encoding, done) {
    buffer += data.toString();
    process.nextTick(done);
  };
  accumulate._flush = function(done) {
    var jso = JSON.parse(buffer.toString());
    handlePLUS_getPLUS(pdbid, jso, mtime);
    process.nextTick(done);
  };
    
  fs.createReadStream(loc) // read in mmJSON-noatom entry
    .pipe(zlib.createGunzip()) // unzip
    .pipe(accumulate); // accumulate buffer & load mmJSON
}

// this function generates the plus files
function handlePLUS_getPLUS(pdbid, jso, mtime) {

  var loc = (build || sync) ? add_loc : add_loc_pre, stats = null, floc;
  for (var i=0; i<loc.length; i++) {
    floc = loc[i]+pdbid+"-add.xml.gz";
    if (fs.existsSync(floc)) {
      stats = fs.statSync(floc);
      break;
    }
  }
  
  if (! mtime) mtime = fs.statSync(saveTarget+"noatom/"+pdbid+"-noatom.json.gz").mtime;
  if (stats) { // plus data is available
  
    var mtime_ = Math.max(stats.mtime.getTime(), mtime.getTime());
    
    // checks whether the data has been updated
    if (! build && fs.existsSync(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz") && fs.statSync(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz").mtime.getTime() >= mtime_) return getJob(); // not updated  
  
    if (! jso) return handlePLUS_getNOATOM(pdbid, mtime); // if no noatom data -> fetch
    
    var buffer = "";
    var accumulate = new Transform();
    accumulate._transform = function(data, encoding, done) {
      buffer += data.toString();
      process.nextTick(done);
    };
    accumulate._flush = function(done) {
      if (buffer.length == 0) buffer = "crap_xml"; // workaround to make sure it goes to the next stage (where xml parsing will fail, but it'll create a dummy json file..)
      this.push(buffer);
      process.nextTick(done);
    };
    
    
    // xml loader helper function
    var xmlHandler = new Transform();
    xmlHandler._transform = function(data, encoding, done) {
      var plus_jso;
      try {
        var xmlData = new DOMParser().parseFromString(data.toString());
        plus_jso = CIF.loadPDBML(xmlData);
        for (var e in plus_jso) {
          if (e == "data_"+pdbid.toUpperCase()+"-add") {
            plus_jso["data_"+pdbid.toUpperCase()+"-plus"] = plus_jso[e];
            delete plus_jso[e]
            break;
          }
        }
      }
      catch (e) {
        plus_jso = {}; plus_jso["data_"+pdbid.toUpperCase()+"-plus"] = {}
      }

      var rs = new stream.Readable(); rs.push(JSON.stringify(plus_jso)); rs.push(null);
      rs.pipe(zlib.createGzip()).pipe(fs.createWriteStream(saveTarget+"plus-add/"+pdbid+"-add.json.gz"))
      .on("close", function() {var dt = new Date(mtime_); fs.utimesSync(saveTarget+"plus-add/"+pdbid+"-add.json.gz", dt, dt);});

      for (var e in plus_jso) jso[e] = plus_jso[e]; // merge
      this.push(JSON.stringify(jso));
      
      process.nextTick(done);
    };

    fs.createReadStream(floc) // read plus data
      .pipe(zlib.createGunzip()) // unzip
      .pipe(accumulate) // accumulate buffer
      .pipe(xmlHandler) // parse xml and convert to JSON
      .pipe(zlib.createGzip()) // compress
      .pipe(fs.createWriteStream(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz")) // write json file
      .on("close", function() { // onclose
        var dt = new Date(mtime_);
        fs.utimesSync(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz", dt, dt);
        getJob();
      })
      ;
  }
  else { // no plus data...
    if (fs.existsSync(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz") && fs.statSync(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz").mtime.getTime() >= mtime.getTime()) return getJob(); // not updated
    
    if (! jso) return handlePLUS_getNOATOM(pdbid, mtime);
  
    jso["data_"+pdbid.toUpperCase()+"-plus"] = {}; // save entry without any plus data
    var rs = new stream.Readable(); rs.push(JSON.stringify(jso)); rs.push(null);
    rs.pipe(zlib.createGzip()).pipe(fs.createWriteStream(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz"))
    .on("close", function() {
      fs.utimesSync(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz", mtime, mtime);
    });
    
    getJob();
  }
};

// traverse FTP to find new/updated entries
function update() {
  //console.log("Starting update process...");
  var refList = (build || sync) ? mmcif_loc : mmcif_loc_pre;
  
  for (var l=0, f; l<refList.length; l++) {
    child_process.execSync("ls "+refList[l]); // first execute a ls command here... --> this should workaround crappy nfs
    (function(dir) {
      fs.statSync(dir);
      fs.readdir(dir, function(err, files) {
        for (var f=0; f<files.length; f++) {
          if (build) cifList.push(dir+files[f]);
          else {
            try {var stats = fs.statSync(saveTarget+"noatom/"+files[f].substr(0, 4)+"-noatom.json.gz");}
            catch (e) {cifList.push(dir+files[f]);}
            if (stats) {
              (function(stats2, floc, pdbid) {
                fs.stat(floc, function(err, stats1) {
                  if (stats1.mtime.getTime() > stats2.mtime.getTime()) cifList.push(floc);
                  else plusList.push(pdbid);
                });
              })(stats, dir+files[f], files[f].substr(0, 4));
            }
          }
        }
      });
    })(refList[l]);
  }

  // remove obsolete entries
  var obs_loc = (build || sync) ? obsolete_loc : obsolete_loc_pre;
  for (var i=0; i<obs_loc.length; i++) {
    fs.readFile(obs_loc[i], function(err, data) {
      var obsolete = data.toString().split("\n");
      for (var i=0; i<obsolete.length; i++) {
        if (! obsolete[i]) continue;
        pdbid = obsolete[i].toLowerCase();
        fs.unlink(saveTarget+"all/"+pdbid+".json.gz", function () {});
        fs.unlink(saveTarget+"noatom/"+pdbid+"-noatom.json.gz", function () {});
        fs.unlink(saveTarget+"plus-add/"+pdbid+"-add.json.gz", function () {});
        fs.unlink(saveTarget+"plus-noatom/"+pdbid+"-plus-noatom.json.gz", function () {});
      }
    });
  }
}

// worker-slave communication; worker handler
function workerMSGhandler(msg) {
  if (msg.job == "cifList") return handleCIF(msg.loc); // new entry to process for the worker
  if (msg.job == "plusList") return handlePLUS_getPLUS(msg.pdbid); // new plus entry to handle for the worker
  if (msg.job == "init") {build = msg.build; sync = msg.sync;} // initialize the worker
  if (msg.job == "die") { // kill the worker process
    //console.log("Updating done.");
    return setTimeout(function() {process.exit();}, 5000); // give it 5 seconds and then exit (to give it enough time to finish any async writing operations)
  }
  setTimeout(getJob, 50); // nothing to do, call the getJob function after a while
}

// worker-slave communication; master handler
function masterMSGhandler(msg) {
  if (msg.request == "job") { // worker asked for a job -> send it
    if (cifList.length) return this.send({job: "cifList", loc: cifList.shift()}); // give it an entry to handle
    else if (plusList.length) return this.send({job: "plusList", pdbid: plusList.shift()}); // give it some plus data to handle
    else if (commandListComplete) return this.send({job: "die"}); // all work is done -> kill it
  }
  if (msg.request == "init") { // initialize the worker
    return this.send({job: "init", build: build, sync: sync});
  }
  this.send({job: null}); // nothing to do
}

function getJob() { // worker-slave communication; gets a job from the master..
  process.send({request: "job"});
}

// checks the progress of the conversion
function checkProgress() {
  var nor = process._getActiveRequests().length;
  if (nor < 50) setTimeout(function() {commandListComplete = true;}, 1000);
  else setTimeout(checkProgress, 1000);
}

// code to releae the mmjson data
function release() {
  fs.renameSync(root+"mmjson"+altName, root+"mmjson-tmp"+altName);
  fs.renameSync(root+"mmjson-pre"+altName, root+"mmjson"+altName);
  fs.renameSync(root+"mmjson-tmp"+altName, root+"mmjson-pre"+altName);
}

// find files that are less than 10b size and rebuild them --> these are broken...
// sometimes the conversion doesn't work perfectly; this code scans for broken entries and fixes them
function fix() {
  
  var base = root+"mmjson-pre/";
  var refList = mmcif_loc_pre;
  if (process.argv.indexOf("--fix-release") != -1) {
    base = root+"mmjson/";
    refList = mmcif_loc;
  }
  
  var scanList = [base+"plus-add/", base+"plus-noatom/", base+"noatom/", base+"all/"];
  
  var crapList = {}, minFileSize = 10;
  
  // scan mmjson files for broken entries and fix them
  for (var l=0, f; l<scanList.length; l++) {
    (function(dir) {
      fs.readdir(dir, function(err, files) {
        var pdbid;
        for (var f=0; f<files.length; f++) {
          pdbid = files[f].substr(0,4);
          if (crapList[pdbid]) continue; // already being processed
          try {var stats = fs.statSync(dir+files[f]); if (stats.size < minFileSize) {crapList[pdbid] = true;}}
          catch(e) {crapList[pdbid] = true;}
          if (crapList[pdbid]) { // if broken, first delete the old files, then rebuild them
            fs.unlink(base+"all/"+pdbid+".json.gz", function() {});
            fs.unlink(base+"noatom/"+pdbid+"-noatom.json.gz", function() {});
            fs.unlink(base+"plus-add/"+pdbid+"-add.json.gz", function() {});
            fs.unlink(base+"plus-noatom/"+pdbid+"-plus-noatom.json.gz", function() {});
            for (var i=0; i<refList.length; i++) {
              try {
                fs.statSync(refList[i]+pdbid+".cif.gz");
                cifList.push(refList[i]+pdbid+".cif.gz");
                break;
              }
              catch (e) {}
            }
          }
        }
      });
    })(scanList[l]);
  }
  
  
}


var runParallel = false, commandListComplete = false;

if (process.argv.indexOf("-update") != -1) runParallel = update;
else if (process.argv.indexOf("-build") != -1) {build = true; runParallel = update;}
else if (process.argv.indexOf("-sync") != -1) {sync = true; runParallel = update;}
else if (process.argv.indexOf("-release") != -1) release();
else if (process.argv.indexOf("-fix") != -1) {runParallel = fix;}

if (runParallel && cluster.isMaster) {
  var numCPUs = require('os').cpus().length;
  
  var worker;
  for (var i = 0; i < numCPUs; i++) {
    worker = cluster.fork();
    worker.on("message", masterMSGhandler);
  }

  runParallel();
  setTimeout(checkProgress, 5000);
  
}
else if (! cluster.isMaster) {
  process.on("message", workerMSGhandler);
  process.send({request: "init"});
}

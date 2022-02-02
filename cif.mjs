/*!
 * cif.js
 *
 * JavaScript CIF parser: https://gitlab.com/pdbjapan/tools/cif-parsers
 * 
 * By Gert-Jan Bekker
 * License: MIT
 *   See https://gitlab.com/pdbjapan/tools/cif-parsers/blob/master/LICENSE
 */

var cifDicPath = "https://data.pdbjbk1.pdbj.org/pdbjplus/dictionaries/mmcif_pdbx.json";
var __CIFDICT__ = null;

// pdbml

function PDBMLparser() {
  this.data = {};
}

PDBMLparser.prototype.parse = function(data) {
  var root = data.documentElement;
  var rootJS = this.data["data_"+root.getAttribute("datablockName")] = {}
  var category, catName, loopMode, cat, scat, skip, item, n;
  for (var i=0, j, k; i<root.childNodes.length; i++) {
    cat = root.childNodes[i];
    catName = cat.localName;
    if (! catName) continue;
    catName = catName.substr(0, catName.length-8);
    category = rootJS[catName] = {};
    loopMode = cat.childNodes.length > 3;
    n = 0;
    for (j=0; j<cat.childNodes.length; j++) {
      scat = cat.childNodes[j];
      if (! scat.localName) continue;
      skip = [];
      for (k=0; k<scat.attributes.length; k++) {
        item = scat.attributes.item(k);
        if (loopMode) {
          if (! category.hasOwnProperty(item.localName)) category[item.localName] = new Array(n);
          category[item.localName].push(item.nodeValue);
          skip.push(item.localName);
        }
        else category[item.localName] = [item.nodeValue];
      }
      for (k=0; k<scat.childNodes.length; k++) {
        item = scat.childNodes[k];
        if (! item.localName) continue;
        if (loopMode) {
          if (! category.hasOwnProperty(item.localName)) category[item.localName] = new Array(n);
          category[item.localName].push(item.textContent);
          skip.push(item.localName);
        }
        else category[item.localName] = [item.textContent];
      }
      if (loopMode) for (k in category) {if (skip.indexOf(k) == -1) category[k].push(null);}
      n++;
    }
  }
}

export async function loadPDBML(data, noCnT) {
  var parser = new PDBMLparser();
  parser.parse(data);

  if (noCnT) return parser.data;
  if (! __CIFDICT__) await loadCIFdic();

  var func, e, e2, e3, i;
  for (e in parser.data) {
    for (e2 in parser.data[e]) {
      if (! __CIFDICT__.hasOwnProperty(e2)) continue;
      for (e3 in parser.data[e][e2]) {
        if (! __CIFDICT__[e2].hasOwnProperty(e3)) continue;
        func = __CIFDICT__[e2][e3];
        if (parser.data[e][e2][e3] instanceof Array) {
          for (i=0; i<parser.data[e][e2][e3].length; i++) parser.data[e][e2][e3][i] = func.call(null, parser.data[e][e2][e3][i]);
        }
        else parser.data[e][e2][e3] = func.call(null, parser.data[e][e2][e3]);
      }
    }
  }
  return parser.data;
}

// mmjson tree

function partition(obj, splt) {
  var [pre, ...post] = obj.split(splt);
  post = post.join(".");
  return [pre, post];
}

// mmcif parser

function _loop(parserObj) {
  this.parserObj = parserObj;
  this.length = 0;
  this.refID = -1;
  this.refList = [];
  this.namesDefined = false;
}

_loop.prototype.addName = function(name) {
  var catName = partition(name, ".");
  
  var ref = this.parserObj.currentTarget[this.parserObj.currentTarget.length-2];
  if (catName[1]) {
    if (! ref.hasOwnProperty(catName[0])) ref[catName[0]] = {};
    if (! ref[catName[0]].hasOwnProperty(catName[1])) ref[catName[0]][catName[1]] = [];
    this.refList.push(ref[catName[0]][catName[1]]);
  }
  else {
    if (! ref.hasOwnProperty(catName[0])) ref[catName[0]] = [];
    this.refList.push(ref[catName[0]]);
  }
  this.length = this.refList.length;
};

_loop.prototype.pushValue = function(value) {
  this.namesDefined = true;
  var target = this.nextTarget();
  if (value == "stop_") return this.stopPush();
  target.push(value);
};

_loop.prototype.nextTarget = function() {
  this.refID = (this.refID+1)%this.length;
  return this.refList[this.refID];
};

_loop.prototype.stopPush = function() {
  this.refID = -1;
};

export function CIFparser() {
  this.data = {};
  this.currentTarget = null;
  this.loopPointer = null;
  this.selectGlobal();
  
  this.error = null; this.buffer = []; this.multi_line_mode = false;
}

CIFparser.prototype.parseLine = function(line, i) {
  var Z;
  try {
    Z = line.substr(0, 1);
    if (Z == "#") return;
    line = line.trim();
    if (Z == ";") {
      if (this.multi_line_mode) this.setDataValue(this.buffer.join("\n"));
      else this.buffer = [];
      this.multi_line_mode = ! this.multi_line_mode;
      line = line.substr(1).trim();
    }
    if (this.multi_line_mode) this.buffer.push(line);
    else this.processContent(this.specialSplit(line));
  }
  catch (e) {this.error = [line, i, e];}
}


CIFparser.prototype.parse = function(lines) {
  if (! Array.isArray(lines)) lines = lines.split("\n");
  for (var i=0; i<lines.length; i++) {
    if (this.error) break;
    this.parseLine(lines[i], i);
  }
  if (this.error) {
    console.error(`Error found in line ${this.error[1]}:`);
    console.error("  ", this.error[2]);
    console.log("  ", this.error[0]);
  }
};

CIFparser.prototype.specialSplit = function(content) {
  var output = [["", false]], quote = false, qtype, length = content.length, isWS, olast=0;
  for (var i=0; i<length; i++) {
    isWS = content[i] == " " || content[i] == "\t";
    if ((content[i] == "'" || content[i] == '"') && (i == 0 || content[i-1] == " " || content[i-1] == "\t" || i == length-1 || content[i+1] == " " || content[i+1] == "\t") && (! quote || (content[i] == qtype))) {quote = ! quote; qtype = content[i];}
    else if (! quote && isWS && output[olast][0] != "") {output.push(["", false]); olast++;}
    else if (! quote && content[i] == "#" && output[olast][0] == "") break;
    else if (! isWS || quote) {output[olast][0] += content[i]; output[olast][1] = quote;}
  }
  if (output[olast][0] == "") output.pop();
  return output;
};

CIFparser.prototype.processContent = function(content) {
  for (var i=0; i<content.length; i++) {
    if (content[i][0] == "global_" && ! content[i][0]) {
      this.loopPointer = null;
      this.selectGlobal();
    }
    else if (content[i][0].substr(0, 5) == "data_" && ! content[i][1]) {
      this.loopPointer = null;
      this.selectData(content[i][0]);
    }
    else if (content[i][0].substr(0, 5) == "save_" && ! content[i][1]) {
      this.loopPointer = null;
      if (content[i][0].substr(5).length) this.selectFrame(content[i][0]);
      else this.endFrame();
    }
    else if (content[i][0] == "loop_" && ! content[i][1]) this.loopPointer = new _loop(this);
    else if (content[i][0].substr(0, 1) == "_" && ! content[i][1]) this.setDataName(content[i][0].substr(1));
    else {
      if (! this.loopPointer && this.dataSet) continue;
      //console.log(content[i][0]);
      this.setDataValue(content[i][0]);
    }
  }
};

CIFparser.prototype.setDataName = function(name) {
  if (this.loopPointer != null) {
    if (this.loopPointer.namesDefined) this.loopPointer = null;
    else return this.loopPointer.addName(name);
  }
  var name = partition(name, ".");
  this.currentTarget.pop();
  if (name[1]) {
    if (! this.currentTarget[this.currentTarget.length-1].hasOwnProperty(name[0])) this.currentTarget[this.currentTarget.length-1][name[0]] = {};
    this.currentTarget[this.currentTarget.length-1][name[0]][name[1]] = "";
    this.currentTarget.push([this.currentTarget[this.currentTarget.length-1][name[0]], name[1]]);
  }
  else {
    this.currentTarget[this.currentTarget.length-1][name[0]] = "";
    this.currentTarget.push([this.currentTarget[this.currentTarget.length-1], name[0]]);
  }
  this.dataSet = false;
};

CIFparser.prototype.setDataValue = function(value) {
  if (this.loopPointer != null) this.loopPointer.pushValue(value);
  else {var tmp = this.currentTarget[this.currentTarget.length-1]; tmp[0][tmp[1]] = [value]; this.dataSet = true;}
};

CIFparser.prototype.selectGlobal = function() {this.currentTarget = [this.data, this.data, null];};

CIFparser.prototype.selectData = function(name) {
  if (! this.data.hasOwnProperty(name)) this.data[name] = {};
  this.currentTarget = [this.data, this.data[name], null];
};

CIFparser.prototype.selectFrame = function(name) {
  if (! this.currentTarget[1].hasOwnProperty(name)) this.currentTarget[1][name] = {};
  this.currentTarget = this.currentTarget.slice(0, 2); this.currentTarget.push(this.currentTarget[1][name]); this.currentTarget.push(null);
};

CIFparser.prototype.endData = function() {this.currentTarget = this.currentTarget.slice(0, 2);};

CIFparser.prototype.endFrame = function() {this.currentTarget = this.currentTarget.slice(0, 3);};

export function parseCIFdictionary(data) {
  var ref = data[Object.keys(data)[0]], name, dic = {};
  for (var e in ref) {
    if (typeof ref[e] != "object" || ref[e] instanceof Array || ! ref[e].hasOwnProperty("item_type")) continue;
    name = partition(e.substr(6), ".");
    if (! dic.hasOwnProperty(name[0])) dic[name[0]] = {};
    dic[name[0]][name[1]] = ref[e].item_type.code[0].trim()
  }
  return dic;
}

export function parse(data) {
  var parser = new CIFparser();
  parser.parse(data);
  return parser.data;
}

export async function loadCIFdic(dic) {
  if (! dic || typeof dic == "string") {
    const request = await fetch(dic);
    

    if (cifDicPath.endsWith(".json")) dic = await request.json();
    else {
      var parser = new CIFparser();
      parser.parse(await request.data());
      dic = parser.data;
    }
    dic = parseCIFdictionary(dic);
  }

  var typing = {}, e2;
  
  for (var e in dic) {
    for (e2 in dic[e]) {
      if (dic[e][e2] == "int" || dic[e][e2] == "positive_int") {
        if (! typing.hasOwnProperty(e)) typing[e] = {};
        typing[e][e2] = parseInt;
      }
      else if (dic[e][e2] == "float") {
        if (! typing.hasOwnProperty(e)) typing[e] = {};
        typing[e][e2] = parseFloat;
      }
      else if (dic[e][e2] == "int-range") {
        if (! typing.hasOwnProperty(e)) typing[e] = {};
        typing[e][e2] = parseIntRange;
      }
      else if (dic[e][e2] == "float-range") {
        if (! typing.hasOwnProperty(e)) typing[e] = {};
        typing[e][e2] = parseFloatRange;
      }
      else if (dic[e][e2] == "boolean") {
        if (! typing.hasOwnProperty(e)) typing[e] = {};
        typing[e][e2] = parseBoolean;
      }
    }
  }

  __CIFDICT__ = typing;
  return typing;
}

function parseIntRange(inp) {
  try {
    var pos = inp.indexOf("-", 1);
    if (pos == -1) throw -1;
    return [parseInt(inp.substr(0, pos)), parseInt(inp.substr(pos+1))];
  }
  catch (e) {return [parseInt(inp)];}
}

function parseFloatRange(inp) {
  try {
    var pos = inp.indexOf("-", 1);
    if (pos == -1) throw -1;
    return [parseFloat(inp.substr(0, pos)), parseFloat(inp.substr(pos+1))];
  }
  catch (e) {return [parseFloat(inp)];}
}

function parseBoolean(inp) {
  return inp.toLowerCase() == "yes";
}

export async function loadCIF(data, noCnT) {
  var parser = new CIFparser();
  parser.parse(data);
  
  if (noCnT) return parser.data;
  if (! __CIFDICT__) await loadCIFdic();
  
  cleanJSON_withDict(parser.data);
  
  return parser.data;
}

export function cleanJSON_withDict(data, cifdic) {
  cifdic = cifdic || __CIFDICT__;
  var e, e2, e3, i;
  for (e in data) {
    for (e2 in data[e]) {
      for (e3 in data[e][e2]) {
        if (data[e][e2][e3] instanceof Array) {
          for (i=0; i<data[e][e2][e3].length; i++) {data[e][e2][e3][i] = ! (data[e][e2][e3][i] == "?" || data[e][e2][e3][i] == ".") ? data[e][e2][e3][i] : null;}
        }
        else data[e][e2][e3] = ! (data[e][e2][e3] == "?" || data[e][e2][e3] == ".") ? data[e][e2][e3] : null;
      }
    }
  }
  
  var func;
  for (e in data) {
    for (e2 in data[e]) {
      if (! cifdic.hasOwnProperty(e2)) continue;
      for (e3 in data[e][e2]) {
        if (! cifdic[e2].hasOwnProperty(e3)) continue;
        func = cifdic[e2][e3];
        if (data[e][e2][e3] instanceof Array) {for (i=0; i<data[e][e2][e3].length; i++) data[e][e2][e3][i] = data[e][e2][e3][i] == null ? null : func.call(null, data[e][e2][e3][i]);}
        else data[e][e2][e3] = data[e][e2][e3] == null ? null : func.call(null, data[e][e2][e3]);
      }
    }
  }
  return data;
}

function cleanJSONcopy_withDict(data, cifdic) {
  cifdic = cifdic || __CIFDICT__;
  
  var copy = {};
  
  var e, e2, e3, i;
  for (e in data) {
    copy[e] = {};
    for (e2 in data[e]) {
      copy[e][e2] = {}
      for (e3 in data[e][e2]) {
        if (data[e][e2][e3] instanceof Array) {
          copy[e][e2][e3] = new Array(data[e][e2][e3].length).fill("");
          for (i=0; i<data[e][e2][e3].length; i++) {copy[e][e2][e3][i] = ! (data[e][e2][e3][i] == "?" || data[e][e2][e3][i] == ".") ? data[e][e2][e3][i] : null;}
        }
        else copy[e][e2][e3] = ! (data[e][e2][e3] == "?" || data[e][e2][e3] == ".") ? data[e][e2][e3] : null;
      }
    }
  }
  
  var func;
  for (e in copy) {
    for (e2 in copy[e]) {
      if (! cifdic.hasOwnProperty(e2)) continue;
      for (e3 in copy[e][e2]) {
        if (! cifdic[e2].hasOwnProperty(e3)) continue;
        func = cifdic[e2][e3];
        if (copy[e][e2][e3] instanceof Array) {for (i=0; i<copy[e][e2][e3].length; i++) copy[e][e2][e3][i] = copy[e][e2][e3][i] == null ? null : func.call(null, copy[e][e2][e3][i]);}
        else copy[e][e2][e3] = copy[e][e2][e3] == null ? null : func.call(null, copy[e][e2][e3]);
      }
    }
  }
  return copy;
}

function countDUMP(data) {
  var outputN = 0;
  
  var sliceConst = '';
  for (var i=0; i<1024; i++) sliceConst += ' ';
  var padString = function(inp, flength) {"use strict";
    return inp+sliceConst.slice(inp.length, flength);
  };
  
  var dumpCat = function(v) {
    outputN++;
    var k, i, noi;
    noi = Object.keys(v); if (noi.length == 0) return;
    noi = v[noi[0]].length;
    if (noi == 0) return;
    if (noi == 1) {for (k2 in v) outputN++;}
    else {
      outputN++;
      for (k2 in v) outputN++;
      for (i=0; i<noi; i++) outputN++;
    }
    outputN++;
  }
  
  var dumpPart = function(part, skip) {
    var k;
    for (k in part) {
      if (typeof(part[k]) == "object" && ! Array.isArray(part[k])) {
        if (k.substr(0, 5) != "data_" && k.substr(0, 5) != "save_" && k.substr(0, 7) != "global_") dumpCat(part[k]);
        else {outputN++; dumpPart(part[k]);}
      }
    }
    outputN++;
  }
  dumpPart(data);
  
  return outputN;
}


export function dumpCIF(data, settings) {
  settings = settings || {};
  var output = "";
  
  var sliceConst = '';
  for (var i=0; i<1024; i++) sliceConst += ' ';
  var padString = function(inp, flength) {"use strict";
    return inp+sliceConst.slice(inp.length, flength);
  };
  
  var dumpCat = function(k, v) {
    if (! settings.omitHash) output += "#\n";
    var k, i, noi, pad, tmp1 = "", tmp2 = [], j, k2;
    noi = Object.keys(v); if (noi.length == 0) return;
    noi = v[noi[0]].length;
    if (noi == 0 && ! settings.forceLoop) return "";
    if (noi == 1 && ! settings.forceLoop) {
      pad = 0
      for (k2 in v) if (k2.length > pad) pad = k2.length;
      pad += 3;
      for (k2 in v) output += "_"+k+"."+padString(k2, pad)+dumpStr(v[k2][0], pad)+"\n"
    }
    else {
      output += "loop_\n";
      pad = [];
      for (k2 in v) {
        output += "_"+k+"."+k2+"\n";
        pad.push(0);
      }
      if (settings.splitLoop) output += "#" + settings.splitLoop + "#\n";
      
      for (i=0; i<noi; i++) {
        j = 0;
        for (k2 in v) {
          tmp1 = dumpStr(v[k2][i]);
          if (tmp1.substr(0,2) != '\n;' && tmp1.length > pad[j]) pad[j] = tmp1.length;
          j++;
        }
      }
      
      for (j=0; j<pad.length; j++) pad[j]++;
      
      for (i=0; i<noi; i++) {
        j = 0;
        tmp1 = "";
        for (k2 in v) {
          tmp1 += padString(dumpStr(v[k2][i]), pad[j]);
          j++;
        }
        output += tmp1+"\n";
        if (i%200000 == 0) output[0]; // old V8 workaround
      }
    }
    if (output.length && output[output.length-1] != "\n") output += "\n";
  }
  
  var inner = true;
  var dumpPart = function(part, skip) {
    var k;
    for (k in part) {
      if (typeof(part[k]) == "object" && ! Array.isArray(part[k])) {
        if (k.substr(0, 5) != "data_" && k.substr(0, 5) != "save_" && k.substr(0, 7) != "global_") dumpCat(k, part[k], true);
        else {output += k+"\n"; dumpPart(part[k]); inner = false;}
      }
    }
    if (!(skip || ! inner)) output += (settings.omitHash ? "" : "#")+"\n";
    output[0]; // old V8 workaround
  }
  dumpPart(data);

  return output;
}

// stream api
export async function streamMMJSON(k, jso, fp) {
  await fp.write(`"${k}":{`);

  var cat, dn;
  
  var cats = Object.keys(jso), dataNames;
  for (var c=0, dn; c<cats.length; c++) {
    await fp.write((c ? ',' : '')+'"'+cats[c]+'":{');
    cat = jso[cats[c]];
    dataNames = Object.keys(cat);
    for (dn=0; dn<dataNames.length; dn++) {
      await fp.write((dn ? ',' : '')+'"'+dataNames[dn]+'":');
      await fp.write(JSON.stringify(cat[dataNames[dn]]));
    }
    await fp.write('}');
  }
  await fp.write('}}');
}

const cifStrCheck = new RegExp("[\\s\(\)]");
const cifStrNLCheck = new RegExp("[\n]");

function dumpStr(inp) {
  if (inp == null) return "?";
  else {
    if (typeof(inp) != "string") return inp+"";
    if (cifStrNLCheck.test(inp)) return "\n;"+inp+"\n;";
    if (cifStrCheck.test(inp)) return "'"+inp+"'";
    return inp;
  }
}

export async function streamCIF(data, settings, fp) {
  settings = settings || {};
  
  var dumpCat = async function(k, v) {
    const refmap = Object.keys(v).map(k2=>v[k2]);
    const noj = refmap.length;
    if (noj == 0) return;
    const noi = refmap[0].length;
    
    if (! settings.omitHash) await fp.write("#\n");
    let i, pad, tmp1 = "", tmp2, j, k2;
    if (noi == 0 && ! settings.forceLoop) return "";
    if (noi == 1 && ! settings.forceLoop) {
      pad = 0
      for (k2 in v) if (k2.length > pad) pad = k2.length;
      pad += 3;
      for (k2 in v) await fp.write("_"+k+"."+k2.padEnd(pad)+dumpStr(v[k2][0])+"\n");
    }
    else {
      await fp.write("loop_\n");
      pad = [];
      for (k2 in v) {
        await fp.write("_"+k+"."+k2+"\n");
        pad.push(0);
      }
      if (settings.splitLoop) await fp.write("#" + settings.splitLoop + "#\n");

      for (i=0; i<noi; i++) {
        for (j=0; j<noj; j++) {
          tmp1 = dumpStr(refmap[j][i]);
          if (tmp1.substr(0,2) != '\n;') {
            tmp2 = tmp1.length;
            if (tmp2 > pad[j]) pad[j] = tmp2;
          }
        }
      }
      for (j=0; j<pad.length; j++) pad[j]++;
      for (i=0; i<noi; i++) {
        tmp1 = "";
        for (j=0; j<noj; j++) tmp1 += dumpStr(refmap[j][i]).padEnd(pad[j]);
        await fp.write(tmp1+"\n");
      }
    }
  }
  
  var inner = true;
  var dumpPart = async function(part, skip) {
    for (let k in part) {
      if (typeof(part[k]) == "object" && ! Array.isArray(part[k])) {
        if (k.substr(0, 5) != "data_" && k.substr(0, 5) != "save_" && k.substr(0, 7) != "global_") await dumpCat(k, part[k]);
        else {await fp.write(k+"\n"); await dumpPart(part[k]); inner = false;}
      }
    }
    if (!(skip || ! inner)) await fp.write((settings.omitHash ? "" : "#")+"\n");
  }
  await dumpPart(data);
}


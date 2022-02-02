# cif-parsers

PDBx/mmCIF parsers implemented in Python & JavaScript, available under the MIT license at https://gitlab.com/pdbjapan/tools/cif-parsers.

The data structure used here is the same as used by the PDBx/mmJSON format, which can be downloaded via PDBj's REST services (https://pdbj.org/help/rest-interface).

Python version usage
--------
```python
import cif
data = cif.__loadCIF__("/path/to/cif/file.cif.gz")
```
Then, if you want to save the entry as a compressed mmJSON file, you can simply do the following:
```python
import json, gzip
json.dump(data, gzip.open("/path/to/json/file.json.gz", "wb"))
```

JavaScript version usage (old cif.js version)
--------
After loading cif.js and loading the data (e.g. via XHR):
```javascript
var data = loadCIF(request.responseText, 1);
```

Saving the entry as a compressed mmJSON file is a bit more complex for JavaScript, as this is primarily a client-side language.
By using nodejs, it is possible to efficiently convert mmCIF files to mmJSON. The mmjson_manager.js script was used by PDBj to convert
the mmCIF files to mmJSON. This has currently been replaced by the new mine2updater (https://gitlab.com/pdbjapan/mine2updater) framework, which also updates our Mine 2 RDB.
For another example on how to save (compressed) mmCIF or mmJSON files, see also our bu-builder tool (https://gitlab.com/pdbjapan/tools/bu-builder), which can generate Biological Units for a given PDB entry.

JavaScript version usage (ES6 cif.mjs version)
--------
After loading cif.js and loading the data (e.g. via XHR):
```javascript
const cif = await import("./cif.mjs");
cif.loadCIF(request.responseText, 1)
```

Alternatively (line-by-line parser for nodejs, which is more memory efficient):
```javascript
const parser = new cif.CIFparser();
// see https://gitlab.com/pdbjapan/mine2updater/-/blob/master/modules/general.js or https://gitlab.com/pdbjapan/tools/bu-builder/-/blob/main/general.mjs for an implementation of readlineGZ
await readlineGZ(fname, function(line) {
  parser.parseLine(line);
  if (parser.error) {
    console.error(`Error found in line ${parser.error[1]}:`);
    console.error("  ", parser.error[2]);
    console.log("  ", parser.error[0]);
    parser.error = null;
  }
});
```

To save the data back to a cif file again:
```javascript
const cifout = cif.dumpCIF(jso_out); // might be problematic for large files (as the whole file is buffered in memory)
const cifout = await cif.streamCIF(jso_out, null, fp); // (is currently only supported by nodejs, as fp is a streamable writable object)
```

Format
--------

Given the following example CIF/STAR file:
```
data_PDBID
#
loop_
_pdbx_category1.field1
_pdbx_category1.field2
_pdbx_category1.field3
1 one 1.0
2 two 2.0
3 three 3.0
4 four 4.0
#
loop_
_pdbx_category2.field1
_pdbx_category2.field2
_pdbx_category2.field3
1 one 1.0
2 two 2.0
#
_pdbx_category3.field1  1
_pdbx_category3.field2  one
_pdbx_category3.field3  1.0
```

After loading the data the `data` element is in the following format:
```json
{
  "data_PDBID": {
    "pdbx_category1": {
      "field1": [1, 2, 3, 4],
      "field2": ["one", "two", "three", "four"],
      "field3": [1.0, 2.0, 3.0, 4.0]
      
    },
    "pdbx_category2": {
      "field1": [1, 2],
      "field2": ["one", "two"],
      "field3": [1.0, 2.0]
    },
    "pdbx_category3": {
      "field1": [1],
      "field2": ["one"],
      "field3": [1.0]
    }
  }
}
```


Here, all `data` objects are elements of an associated array. Each category within a `data` object is again an element of their parent `data` object, represented as an associative array. The `data items` of the category are key-value pairs within this associative array, where the values are an array of `data values` to include `loop_` structures. No discrimination is made between `loop_` and regular structures, both are stored as an associative array. The "." and "?" CIF values are both saved as `null` values in mmJSON, since `undefined` is unfortunately not available in JSON in order to distinguish the two.

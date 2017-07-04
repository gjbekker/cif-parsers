# cif-parsers

PDBx/mmCIF parsers implemented in Python & JavaScript, available under the MIT license.

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

JavaScript version usage
--------
After loading cif.js and loading the data (e.g. via XHR):
```javascript
var data = loadCIF(request.responseText, 1);
```

Saving the entry as a compressed mmJSON file is a bit more complex for JavaScript, as this is primarily a client-side language.
By using nodejs, it is possible to efficiently convert mmCIF files to mmJSON. The mmjson_manager.js script is used by PDBj to convert
the mmCIF files to mmJSON and can serve as an example for those wanting to convert their own CIF files to JSON.

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

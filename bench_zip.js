'use strict';

// Define objects and functions that j2me.js expects
// but are unavailable in the shell environment.

var inBrowser = typeof pc2line === "undefined";

if (!inBrowser) {
  var console = {
    log: print,
  }
  console.info = function (c) {
    putstr(String.fromCharCode(c));
  };

  console.error = function (c) {
    putstr(String.fromCharCode(c));
  };
} else {
  var dateNow = function() {
    return performance.now();
  }
}

var jsGlobal = this;

function run(zipFileBuffer) {
  try {
    var start = dateNow();

    var zipFile = new ZipFile(zipFileBuffer);
    var files = Object.keys(zipFile.directory);
    var dataLength = 0;
    var jsTime = 0;
    var asmTime = 0;

    for (var loops = 0; loops < 10; loops++) {
      for (var i = 0; i < files.length; i++) {
        // console.log(files[i]);

        var entry = zipFile.directory[files[i]];
        if (entry.compression_method === 8) {
          var jsStartTime = dateNow();
          var d1 = zipFile.read(files[i]);
          jsTime += dateNow() - jsStartTime;

          var asmStartTime = dateNow();
          var compressedData = entry.compressed_data;
          var inBufLength = compressedData.length * compressedData.BYTES_PER_ELEMENT;
          var inBuf = Module._malloc(inBufLength);
          Module.HEAPU8.set(compressedData, inBuf);
          var outBuf = Module._malloc(entry.uncompressed_len);
          ASM._inflate(inBuf, inBufLength, outBuf, entry.uncompressed_len);

          var u8 = ASM.HEAPU8;
          // var out = new Uint8Array(entry.uncompressed_len);
          // for (var j = 0; j < entry.uncompressed_len; j++) {
          //   out[j] = u8[outBuf + j];
          // }
          asmTime += dateNow() - asmStartTime;

          for (var j = 0; j < entry.uncompressed_len; j++) {
            // console.log(u8[outBuf + j]  + " " + d1[j]);
            if (u8[outBuf + j] !== d1[j]) {
              throw "FAIL WHALE!!!!!!!!!!!!!!!!!!";
            }
          }
          Module._free(outBuf);
          Module._free(inBuf);
          // break;

          // dataLength += d1.length;
        }
      }
    }

    //JARStore.addBuiltIn("tests/tests.jar", snarf("tests/tests.jar", "binary").buffer);
    //JARStore.addBuiltIn("bench/benchmark.jar", snarf("bench/benchmark.jar", "binary").buffer);
    //JARStore.addBuiltIn("program.jar", snarf("program.jar", "binary").buffer);


    console.log("-------------------------------------------------------");
    console.log("Total Time JS: " + jsTime.toFixed(4) + " ms");
    console.log("Total Time ASM: " + asmTime.toFixed(4) + " ms");
    console.log("Total Time: " + (dateNow() - start).toFixed(4) + " ms");
    console.log("Total Bytes: " + dataLength + " bytes");
    console.log("-------------------------------------------------------");
  } catch (x) {
    console.log(x);
    console.log(x.stack);
  }
}

var fileUrl = "wa~/WhatsApp_2_12_89.jar";

if (inBrowser) {
  load(fileUrl, "arraybuffer").then(function(data) {
    run(data);
  });
} else {
  load("bld/native.js");
  load("bench_pre_zip.js");
  load("libs/zipfile.js");
  run(snarf(fileUrl, "binary").buffer)
}
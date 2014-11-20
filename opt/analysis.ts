module J2ME {
  import Bytecodes = Bytecode.Bytecodes;
  import BytecodeStream = Bytecode.BytecodeStream;

  declare var CLASSES;
  
  export function getYieldingMethods(jar) {
    var yields = { "java/lang/Thread.yield.()V": true } ;
    var methods = 1;
    var methodsWithYield = 1;

    Object.keys(jar.directory).every(function (fileName) {
      if (fileName.substr(-6) !== '.class') {
        return true;
      }
      var classInfo = CLASSES.loadClassFile(fileName);
      for (var i = 0; i < classInfo.methods.length; i++) {
        var method = classInfo.methods[i];
        methods++;
        if (methodYields(method)) {
            yields[method.implKey] = true;
            methodsWithYield++;
        }
      }
      return true;
    }.bind(this));

    console.log("Methods with yield: " + methodsWithYield);
    console.log("Total methods: " + methods);
    return yields;
  }


  function methodYields(methodInfo: MethodInfo) {
    if (methodInfo.isSynchronized) {
      return true;
    }
    if (methodInfo.alternateImpl) {
      if ((<any>methodInfo.alternateImpl).usesPromise) {
        return true;
      }
      return false;
    }
    if (!methodInfo.code) { 
      return false;
    }
    var stream = new BytecodeStream(methodInfo.code);
    while (stream.currentBCI < stream.endBCI()) {
      var opcode: Bytecodes = stream.currentBC();
      switch (opcode) {
        case Bytecodes.MONITORENTER:
          return true;
      }
      stream.next();
    }
    return false;
  }

  export function getCallGraph(jar, resolve) {
    var staticCallGraph = Object.create(null);
    var methods = 0;

    Object.keys(jar.directory).every(function (fileName) {
      if (fileName.substr(-6) !== '.class') {
        return true;
      }
      var classInfo = CLASSES.loadClassFile(fileName);
      for (var i = 0; i < classInfo.methods.length; i++) {
        methods++;
        var methodInfo = classInfo.methods[i];
        var callees = staticCallGraph[methodInfo.implKey] = [];
        if (!methodInfo.code) {
          continue;
        }
        var stream = new BytecodeStream(methodInfo.code);
        while (stream.currentBCI < stream.endBCI()) {
          var opcode: Bytecodes = stream.currentBC();
          switch (opcode) {
            case Bytecodes.INVOKEVIRTUAL  :
            case Bytecodes.INVOKESPECIAL  :
            case Bytecodes.INVOKESTATIC   :
            case Bytecodes.INVOKEINTERFACE:
              callees = staticCallGraph[methodInfo.implKey];
              var cpi = stream.readCPI();
              var calleMethodInfo = resolve(methodInfo.classInfo.constant_pool, cpi, opcode === Bytecodes.INVOKESTATIC);
              ArrayUtilities.pushUnique(callees, calleMethodInfo.implKey);              
              break;
          }
          stream.next();
        }
      }
      return true;
    }.bind(this));


    console.log("Total methods: " + methods);
    return staticCallGraph;
  }
}
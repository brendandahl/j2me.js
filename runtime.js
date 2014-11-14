/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

function Runtime(vm) {
  this.vm = vm;
  this.status = 1; // NEW
  this.waiting = [];
  this.threadCount = 0;
  this.initialized = {};
  this.pending = {};
  this.staticFields = {};
  this.classObjects = {};

  this.methodInfos = {};
  this.classInfos = {};
  this.fieldInfos = {};
  this.functions = {};
}

Runtime.prototype.waitStatus = function(callback) {
  this.waiting.push(callback);
}

Runtime.prototype.updateStatus = function(status) {
  this.status = status;
  var waiting = this.waiting;
  this.waiting = [];
  waiting.forEach(function(callback) {
    try {
      callback();
    } catch(ex) {
      // If the callback calls Runtime.prototype.waitStatus to continue waiting,
      // then waitStatus will throw VM.Pause, which shouldn't propagate up to
      // the caller of Runtime.prototype.updateStatus, so we silently ignore it
      // (along with any other exceptions thrown by the callback, so they don't
      // propagate to the caller of updateStatus).
    }
  });
}

Runtime.all = new Set();

Runtime.prototype.addContext = function(ctx) {
  ++this.threadCount;
  Runtime.all.add(this);
}

Runtime.prototype.removeContext = function(ctx) {
  if (!--this.threadCount) {
    Runtime.all.delete(this);
    this.updateStatus(4); // STOPPED
  }
}

Runtime.prototype.newPrimitiveArray = function(type, size) {
  var constructor = ARRAYS[type];
  if (!constructor.prototype.class)
    CLASSES.initPrimitiveArrayType(type, constructor);
  return new constructor(size);
}

Runtime.prototype.newArray = function(typeName, size) {
  return new (CLASSES.getClass(typeName).constructor)(size);
}

Runtime.prototype.newMultiArray = function(typeName, lengths) {
  var length = lengths[0];
  var array = this.newArray(typeName, length);
  if (lengths.length > 1) {
    lengths = lengths.slice(1);
    for (var i=0; i<length; i++)
      array[i] = this.newMultiArray(typeName.substr(1), lengths);
  }
  return array;
}

Runtime.prototype.newObject = function(classInfo) {
    return new (classInfo.constructor)();
}

Runtime.prototype.newString = function(s) {
  var obj = this.newObject(CLASSES.java_lang_String);
  obj.str = s;
  return obj;
}

Runtime.prototype.newStringConstant = function(s) {
    if (internedStrings.has(s)) {
        return internedStrings.get(s);
    }
    var obj = this.newString(s);
    internedStrings.set(s, obj);
    return obj;
}

Runtime.prototype.setStatic = function(field, value) {
  this.staticFields[field.id] = value;
}

Runtime.prototype.getStatic = function(field) {
  return this.staticFields[field.id];
}

Runtime.prototype.resolve = function(cp, idx, isStatic) {
  var constant = cp[idx];
  if (!constant.tag)
    return constant;
  switch(constant.tag) {
    case 3: // TAGS.CONSTANT_Integer
      constant = constant.integer;
      break;
    case 4: // TAGS.CONSTANT_Float
      constant = constant.float;
      break;
    case 8: // TAGS.CONSTANT_String
      constant = this.newStringConstant(cp[constant.string_index].bytes);
      break;
    case 5: // TAGS.CONSTANT_Long
      constant = Long.fromBits(constant.lowBits, constant.highBits);
      break;
    case 6: // TAGS.CONSTANT_Double
      constant = constant.double;
      break;
    case 7: // TAGS.CONSTANT_Class
      constant = CLASSES.getClass(cp[constant.name_index].bytes);
      break;
    case 9: // TAGS.CONSTANT_Fieldref
      var classInfo = this.resolve(cp, constant.class_index, isStatic);
      var fieldName = cp[cp[constant.name_and_type_index].name_index].bytes;
      var signature = cp[cp[constant.name_and_type_index].signature_index].bytes;
      constant = CLASSES.getField(classInfo, (isStatic ? "S" : "I") + "." + fieldName + "." + signature);
      if (!constant) {
        throw new JavaException("java/lang/RuntimeException",
            classInfo.className + "." + fieldName + "." + signature + " not found");
      }
      break;
    case 10: // TAGS.CONSTANT_Methodref
    case 11: // TAGS.CONSTANT_InterfaceMethodref
      var classInfo = this.resolve(cp, constant.class_index, isStatic);
      var methodName = cp[cp[constant.name_and_type_index].name_index].bytes;
      var signature = cp[cp[constant.name_and_type_index].signature_index].bytes;
      constant = CLASSES.getMethod(classInfo, (isStatic ? "S" : "I") + "." + methodName + "." + signature);
      if (!constant) {
        throw new JavaException("java/lang/RuntimeException",
            classInfo.className + "." + methodName + "." + signature + " not found");
      }
      break;
    default:
      throw new Error("not support constant type");
  }
  return constant;
};

Runtime.prototype.setupPrecompiledDependencies = function(dependencies) {
  function lazy(obj, key, getter) {
    Object.defineProperty(obj, key, {
      get: function(key) {
        var value = getter();
        Object.defineProperty(this, key, {
          value: value,
          configurable: true,
          enumerable: true
        });
        return value;
      }.bind(obj, key),
      configurable: true,
      enumerable: true
    });
  }

  var classes = dependencies.classes;
  for (var key in classes) {
    var className = classes[key];
    lazy(this.classInfos, key, function(className) {
      return CLASSES.loadClass(className);
    }.bind(null, className));
  }

  var methods = dependencies.methods;
  for (var key in methods) {
    var method = methods[key];
    lazy(this.methodInfos, key, function(className, methodKey) {
      var classInfo = CLASSES.loadClass(className);
      return CLASSES.getMethod(classInfo, methodKey);
    }.bind(null, method[0], method[1]));
  }

  var fields = dependencies.fields;
  for (var key in fields) {
    var field = fields[key];
    lazy(this.fieldInfos, key, function(className, fieldKey) {
      var classInfo = CLASSES.loadClass(className);
      return CLASSES.getField(classInfo, fieldKey);
    }.bind(null, field[0], field[1]));
  }

  var staticCalls = dependencies.staticCalls;
  for (var key in staticCalls) {
    var method = staticCalls[key];
    Object.defineProperty(this.functions, key, {
      get: function(key, className, methodKey) {
        var classInfo = CLASSES.loadClass(className);
        var methodInfo = CLASSES.getMethod(classInfo, methodKey);
        return J2ME.buildCompiledCall(this, key, methodInfo);
      }.bind(this.functions, key, method[0], method[1]),
      configurable: true,
      enumerable: true
    });
  }
};


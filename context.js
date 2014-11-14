/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

function Context(runtime) {
  this.frames = [];
  this.frameSets = [];
  this.runtime = runtime;
  this.runtime.addContext(this);
  // TODO these should probably be moved to runtime...
  this.methodInfos = runtime.methodInfos;
  this.classInfos = runtime.classInfos;
  this.fieldInfos = runtime.fieldInfos;
}

Context.prototype.kill = function() {
  this.runtime.removeContext(this);
}

Context.prototype.current = function() {
  var frames = this.frames;
  return frames[frames.length - 1];
}

Context.prototype.pushFrame = function(methodInfo) {
  var caller = this.current();
  var callee;
  if (caller === undefined) {
    if (methodInfo.consumes !== 0) {
      throw new Error("A frame cannot consume arguments from a compiled frame.");
    }
    callee = new Frame(methodInfo, [], 0);
  } else {
    callee = new Frame(methodInfo, caller.stack.slice(caller.stack.length - methodInfo.consumes), 0);
    caller.stack.length -= methodInfo.consumes;
  }
  this.frames.push(callee);
  Instrument.callEnterHooks(methodInfo, caller, callee);
  return callee;
}

Context.prototype.popFrame = function() {
  var callee = this.frames.pop();
  if (this.frames.length === 0) {
    return null;
  }
  var caller = this.current();
  Instrument.callExitHooks(callee.methodInfo, caller, callee);
  return caller;
}

Context.prototype.pushClassInitFrame = function(classInfo) {
  if (this.runtime.initialized[classInfo.className])
    return;
  classInfo.thread = this.thread;
  var syntheticMethod = new MethodInfo({
    name: "ClassInitSynthetic",
    signature: "()V",
    isStatic: false,
    classInfo: {
      className: classInfo.className,
      vmc: {},
      vfc: {},
      constant_pool: [
        null,
        { tag: TAGS.CONSTANT_Methodref, class_index: 2, name_and_type_index: 4 },
        { tag: TAGS.CONSTANT_Class, name_index: 3 },
        { bytes: "java/lang/Class" },
        { name_index: 5, signature_index: 6 },
        { bytes: "invoke_clinit" },
        { bytes: "()V" },
        { tag: TAGS.CONSTANT_Methodref, class_index: 2, name_and_type_index: 8 },
        { name_index: 9, signature_index: 10 },
        { bytes: "init9" },
        { bytes: "()V" },
      ],
    },
    code: new Uint8Array([
        0x2a,             // aload_0
        0x59,             // dup
        0x59,             // dup
        0x59,             // dup
        0xc2,             // monitorenter
        0xb7, 0x00, 0x01, // invokespecial <idx=1>
        0xb7, 0x00, 0x07, // invokespecial <idx=7>
        0xc3,             // monitorexit
        0xb1,             // return
    ])
  });
  this.current().stack.push(classInfo.getClassObject(this));
  this.pushFrame(syntheticMethod);
}

Context.prototype.raiseException = function(className, message) {
  if (!message)
    message = "";
  message = "" + message;
  var syntheticMethod = new MethodInfo({
    name: "RaiseExceptionSynthetic",
    signature: "()V",
    isStatic: true,
    classInfo: {
      className: className,
      vmc: {},
      vfc: {},
      constant_pool: [
        null,
        { tag: TAGS.CONSTANT_Class, name_index: 2 },
        { bytes: className },
        { tag: TAGS.CONSTANT_String, string_index: 4 },
        { bytes: message },
        { tag: TAGS.CONSTANT_Methodref, class_index: 1, name_and_type_index: 6 },
        { name_index: 7, signature_index: 8 },
        { bytes: "<init>" },
        { bytes: "(Ljava/lang/String;)V" },
      ],
    },
    code: new Uint8Array([
      0xbb, 0x00, 0x01, // new <idx=1>
      0x59,             // dup
      0x12, 0x03,       // ldc <idx=2>
      0xb7, 0x00, 0x05, // invokespecial <idx=5>
      0xbf              // athrow
    ])
  });
  //  pushFrame() is not used since the invoker may be a compiled frame.
  var callee = new Frame(syntheticMethod, [], 0);
  this.frames.push(callee);
}

Context.prototype.raiseExceptionAndYield = function(className, message) {
  this.raiseException(className, message);
  throw VM.Yield;
}

Context.prototype.nullCheck = function(object) {
  if (!object) {
    this.raiseExceptionAndYield("java/lang/NullPointerException");
  }
};

Context.prototype.divideByZeroCheck = function(object) {
  if (object === 0) {
    this.raiseExceptionAndYield("java/lang/ArithmeticException", "/ by zero");
  }
};

Context.prototype.divideByZeroCheckLong = function(object) {
  if (object.isZero()) {
    this.raiseExceptionAndYield("java/lang/ArithmeticException", "/ by zero");
  }
};

Context.prototype.checkCast = function(classInfoId, object) {
  var classInfo = this.classInfos[classInfoId];
  if (object && !object.class.isAssignableTo(classInfo)) {
    this.raiseExceptionAndYield("java/lang/ClassCastException",
        object.class.className + " is not assignable to " +
        classInfo.className);
  }
};

Context.prototype.instanceOf = function(classInfoId, object) {
  var classInfo = this.classInfos[classInfoId];
  var result = !object ? false : object.class.isAssignableTo(classInfo);
  return result ? 1 : 0;
};

Context.prototype.invokeCompiledFn = function(methodInfo, args) {
  args.unshift(this, 0);
  var fn = methodInfo.fn;
  this.frameSets.push(this.frames);
  this.frames = [];
  var returnValue = fn.apply(null, args);
  this.frames = this.frameSets.pop();
  return returnValue;
};

Context.prototype.compileMethodInfo = function(methodInfo) {
  var fn = J2ME.compileMethodInfo(methodInfo, this, J2ME.CompilationTarget.Runtime);
  if (fn) {
    methodInfo.fn = fn;
  } else {
    methodInfo.dontCompile = true;
  }
};

Context.prototype.execute = function() {
  Instrument.callResumeHooks(this.current());
  do {
    try {
      VM.execute(this);
    } catch (e) {
      switch (e) {
      case VM.Yield:
        // Ignore the yield and continue executing instructions on this thread.
        break;
      case VM.Pause:
        Instrument.callPauseHooks(this.current());
        return;
      default:
        throw e;
      }
    }
  } while (this.frames.length !== 0);
}

Context.prototype.start = function() {
  var ctx = this;
  Instrument.callResumeHooks(ctx.current());
  try {
    VM.execute(ctx);
  } catch (e) {
    switch (e) {
    case VM.Yield:
      break;
    case VM.Pause:
      Instrument.callPauseHooks(ctx.current());
      return;
    default:
      console.info(e);
      throw e;
    }
  }
  Instrument.callPauseHooks(ctx.current());

  if (ctx.frames.length === 0) {
      ctx.kill();
    return;
  }

  ctx.resume();
}

Context.prototype.resume = function() {
  window.setZeroTimeout(this.start.bind(this));
}

Context.prototype.block = function(obj, queue, lockLevel) {
  if (!obj[queue])
    obj[queue] = [];
  obj[queue].push(this);
  this.lockLevel = lockLevel;
  throw VM.Pause;
}

Context.prototype.unblock = function(obj, queue, notifyAll, callback) {
  while (obj[queue] && obj[queue].length) {
    var ctx = obj[queue].pop();
    if (!ctx)
      continue;
    callback(ctx);
    if (!notifyAll)
      break;
  }
}

Context.prototype.wakeup = function(obj) {
  if (this.lockTimeout !== null) {
    window.clearTimeout(this.lockTimeout);
    this.lockTimeout = null;
  }
  if (obj.lock) {
    if (!obj.ready)
      obj.ready = [];
    obj.ready.push(this);
  } else {
    while (this.lockLevel-- > 0)
      this.monitorEnter(obj);
    this.resume();
  }
}

Context.prototype.monitorEnter = function(obj) {
  var lock = obj.lock;
  if (!lock) {
    obj.lock = { thread: this.thread, level: 1 };
    return;
  }
  if (lock.thread === this.thread) {
    ++lock.level;
    return;
  }
  this.block(obj, "ready", 1);
}

Context.prototype.monitorExit = function(obj) {
  var lock = obj.lock;
  if (lock.thread !== this.thread)
    this.raiseExceptionAndYield("java/lang/IllegalMonitorStateException");
  if (--lock.level > 0) {
    return;
  }
  obj.lock = null;
  this.unblock(obj, "ready", false, function(ctx) {
    ctx.wakeup(obj);
  });
}

Context.prototype.wait = function(obj, timeout) {
  var lock = obj.lock;
  if (timeout < 0)
    this.raiseExceptionAndYield("java/lang/IllegalArgumentException");
  if (!lock || lock.thread !== this.thread)
    this.raiseExceptionAndYield("java/lang/IllegalMonitorStateException");
  var lockLevel = lock.level;
  while (lock.level > 0)
    this.monitorExit(obj);
  if (timeout) {
    var self = this;
    this.lockTimeout = window.setTimeout(function() {
      obj.waiting.forEach(function(ctx, n) {
        if (ctx === self) {
          obj.waiting[n] = null;
          ctx.wakeup(obj);
        }
      });
    }, timeout);
  } else {
    this.lockTimeout = null;
  }
  this.block(obj, "waiting", lockLevel);
}

Context.prototype.notify = function(obj, notifyAll) {
  if (!obj.lock || obj.lock.thread !== this.thread)
    this.raiseExceptionAndYield("java/lang/IllegalMonitorStateException");
  this.unblock(obj, "waiting", notifyAll, function(ctx) {
    ctx.wakeup(obj);
  });
}

Context.prototype.newPrimitiveArray = function(type, size) {
  return this.runtime.newPrimitiveArray(type, size);
}

Context.prototype.newArray = function(typeName, size) {
  return this.runtime.newArray(typeName, size);
}

Context.prototype.newMultiArray = function(typeName, lengths) {
  return this.runtime.newMultiArray(typeName, lengths);
}

Context.prototype.newObject = function(classInfo) {
  return this.runtime.newObject(classInfo);
}

Context.prototype.newObjectFromId = function(id) {
    return this.runtime.newObject(this.classInfos[id]);
}

Context.prototype.newString = function(s) {
  return this.runtime.newString(s);
}

Context.prototype.newStringConstant = function(s) {
    return this.runtime.newStringConstant(s);
}

Context.prototype.getStatic = function(fieldInfoId, type) {
  // TODO unify this with getstatic in runtime and the VM getstatic code.
  var value = this.runtime.staticFields[fieldInfoId];
  if (typeof value === "undefined") {
    value = util.defaultValue(type);
  }
  return value;
};

Context.prototype.putStatic = function(fieldInfoId, value) {
    this.runtime.staticFields[fieldInfoId] = value;
};

Context.prototype.triggerBailout = function(e, methodInfoId, compiledDepth, cpi, locals, stack) {
  throw VM.Yield;
};

Context.prototype.JVMBailout = function(e, methodInfoId, compiledDepth, cpi, locals, stack) {
    var methodInfo = this.methodInfos[methodInfoId];
    var frame = new Frame(methodInfo, locals, 0);
    frame.stack = stack;
    frame.ip = cpi;
    this.frames.unshift(frame);
    if (compiledDepth === 0 && this.frameSets.length) {
      // Append all the current frames to the parent frame set, so a single frame stack
      // exists when the bailout finishes.
      var currentFrames = this.frames;
      this.frames = this.frameSets.pop();
      for (var i = 0; i < currentFrames.length; i++) {
        this.frames.push(currentFrames[i]);
      }
    }
};

Context.prototype.classInitCheck = function(className) {
    if (this.runtime.initialized[className])
        return;
    throw VM.Yield;
};

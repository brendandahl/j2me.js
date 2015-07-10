/*
 node-jvm
 Copyright (c) 2013 Yaroslav Gaponov <yaroslav.gaponov@gmail.com>
*/

var $: J2ME.Runtime; // The currently-executing runtime.

var tempReturn0 = 0;

interface Math {
  fround(value: number): number;
}
interface Long {
  isZero(): boolean;
  toNumber(): number;
}
declare var Long: {
  new (low: number, high: number): Long;
  ZERO: Long;
  fromBits(lowBits: number, highBits: number): Long;
  fromInt(value: number);
  fromNumber(value: number);
}

interface CompiledMethodCache {
  get(key: string): { key: string; source: string; referencedClasses: string[]; };
  put(obj: { key: string; source: string; referencedClasses: string[]; }): Promise<any>;
}

interface AOTMetaData {
  /**
   * On stack replacement pc entry points.
   */
  osr: number [];
}

declare var throwHelper;
declare var throwPause;
declare var throwYield;

module J2ME {

  export function returnLong(l: number, h: number) {
    tempReturn0 = h;
    return l;
  }

  export function returnLongValue(v: number) {
    var value = Long.fromNumber(v);
    return returnLong(value.low_, value.high_);
  }

  declare var Native, config;
  declare var VM;
  declare var CompiledMethodCache;

  export var aotMetaData = <{string: AOTMetaData}>Object.create(null);

  /**
   * Turns on just-in-time compilation of methods.
   */
  export var enableRuntimeCompilation = false;

  /**
   * Turns on onStackReplacement
   */
  export var enableOnStackReplacement = true;

  /**
   * Turns on caching of JIT-compiled methods.
   */
  export var enableCompiledMethodCache = true && typeof CompiledMethodCache !== "undefined";

  /**
   * Traces method execution.
   */
  export var traceWriter = null;

  /**
   * Traces bytecode execution.
   */
  export var traceStackWriter = null;

  /**
   * Traces performance problems.
   */
  export var perfWriter = null;

  /**
   * Traces linking and class loading.
   */
  export var linkWriter = null;

  /**
   * Traces JIT compilation.
   */
  export var jitWriter = null;

  /**
   * Traces class loading.
   */
  export var loadWriter = null;

  /**
   * Traces winding and unwinding.
   */
  export var windingWriter = null;

  /**
   * Traces class initialization.
   */
  export var initWriter = null;

  /**
   * Traces thread execution.
   */
  export var threadWriter = null;

  /**
   * Traces generated code.
   */
  export var codeWriter = null;

  export enum MethodState {
    /**
     * All methods start in this state.
     */
    Cold = 0,

    /**
     * Methods have this state if code has been compiled for them or
     * there is a native implementation that needs to be used.
     */
    Compiled = 1,

    /**
     * We don't want to compiled these methods, they may be too large
     * to benefit from JIT compilation.
     */
    NotCompiled = 2,

    /**
     * Methods are not compiled because of some exception.
     */
    CannotCompile = 3
  }

  declare var Shumway;

  export var timeline;
  export var threadTimeline;
  export var methodTimelines = [];
  export var nativeCounter = release ? null : new Metrics.Counter(true);
  export var runtimeCounter = release ? null : new Metrics.Counter(true);
  export var baselineMethodCounter = release ? null : new Metrics.Counter(true);
  export var asyncCounter = release ? null : new Metrics.Counter(true);
  export var jitMethodInfos = {};

  export var unwindCount = 0;

  if (typeof Shumway !== "undefined") {
    timeline = new Shumway.Tools.Profiler.TimelineBuffer("Runtime");
    threadTimeline = new Shumway.Tools.Profiler.TimelineBuffer("Threads");
  }

  export function enterTimeline(name: string, data?: any) {
    timeline && timeline.enter(name, data);
  }

  export function leaveTimeline(name?: string, data?: any) {
    timeline && timeline.leave(name, data);
  }

  export var Klasses = {
    java: {
      lang: {
        Object: null,
        Class: null,
        String: null,
        Thread: null,
        IllegalArgumentException: null,
        IllegalStateException: null,
        NullPointerException: null,
        RuntimeException: null,
        IndexOutOfBoundsException: null,
        ArrayIndexOutOfBoundsException: null,
        StringIndexOutOfBoundsException: null,
        ArrayStoreException: null,
        IllegalMonitorStateException: null,
        ClassCastException: null,
        NegativeArraySizeException: null,
        ArithmeticException: null,
        ClassNotFoundException: null,
        SecurityException: null,
        IllegalThreadStateException: null,
        InstantiationException: null,
        Exception: null
      },
      io: {
        IOException: null,
        UTFDataFormatException: null,
        UnsupportedEncodingException: null
      }
    },
    javax: {
      microedition: {
        media: {
          MediaException: null
        }
      }
    },
    boolean: null,
    char: null,
    float: null,
    double: null,
    byte: null,
    short: null,
    int: null,
    long: null
  };

  function Int64Array(buffer: ArrayBuffer, offset: number, length: number) {
    this.value = new Int32Array(buffer, offset, length * 2);
    this.length = length;
  }
  Int64Array.prototype.BYTES_PER_ELEMENT = 8;

  /**
   * We can't always mutate the |__proto__|.
   */
  function isPrototypeOfFunctionMutable(fn: Function): boolean {
    // We don't list all builtins here, since not all of them are used in the object
    // hierarchy.
    switch (fn) {
      case Object:
      case Array:
      case Uint8Array:
      case Uint16Array:
      case Float32Array:
      case Float64Array:
      case Int8Array:
      case Int16Array:
      case Int32Array:
      case Int64Array:
        return false;
      default:
        return true;
    }
  }

  export var stdoutWriter = new IndentingWriter();
  export var stderrWriter = new IndentingWriter(false, IndentingWriter.stderr);

  export enum ExecutionPhase {
    /**
     * Default runtime behaviour.
     */
    Runtime = 0,

    /**
     * When compiling code statically.
     */
    Compiler = 1
  }

  export var phase = ExecutionPhase.Runtime;

  // Initial capacity of the interned strings is the capacity of a large midlet after startup.
  export var internedStrings: TypedArrayHashtable = new TypedArrayHashtable(767);

  declare var util;

  import assert = J2ME.Debug.assert;

  export enum RuntimeStatus {
    New       = 1,
    Started   = 2,
    Stopping  = 3, // Unused
    Stopped   = 4
  }

  export enum MethodType {
    Interpreted,
    Native,
    Compiled
  }

  var hashMap = Object.create(null);

  var hashArray = new Int32Array(1024);

  function hashString(s: string) {
    if (hashArray.length < s.length) {
      hashArray = new Int32Array((hashArray.length * 2 / 3) | 0);
    }
    var data = hashArray;
    for (var i = 0; i < s.length; i++) {
      data[i] = s.charCodeAt(i);
    }
    var hash = HashUtilities.hashBytesTo32BitsMurmur(data, 0, s.length);

    if (!release) { // Check to see that no collisions have ever happened.
      if (hashMap[hash] && hashMap[hash] !== s) {
        assert(false, "This is very bad.")
      }
      hashMap[hash] = s;
    }

    return hash;
  }

  export function hashUTF8String(s: Uint8Array): number {
    var hash = HashUtilities.hashBytesTo32BitsMurmur(s, 0, s.length);
    if (!release) { // Check to see that no collisions have ever happened.
      if (hashMap[hash] && hashMap[hash] !== s) {
        assert(false, "This is very bad.")
      }
      hashMap[hash] = s;
    }

    return hash;
  }

  function isIdentifierChar(c: number): boolean {
    return (c >= 97   && c <= 122)   || // a .. z
           (c >= 65   && c <=  90)   || // A .. Z
           (c === 36) || (c === 95);    // $ && _
  }

  function isDigit(c: number): boolean {
    return c >= 48 && c <= 57;
  }

  function needsEscaping(s: string): boolean {
    var l = s.length;
    for (var i = 0; i < l; i++) {
      var c = s.charCodeAt(i);
      if (!isIdentifierChar(c)) {
        return true;
      }
    }
    return false;
  }

  // Fast lookup table.
  var map = new Array(128);
  for (var i = 0; i < 128; i++) {
    map[i] = String.fromCharCode(i);
  }

  // Patch up some entries.
  var invalidChars = "[];/<>()";
  var replaceChars = "abc_defg";
  for (var i = 0; i < invalidChars.length; i++) {
    map[invalidChars.charCodeAt(i)] = replaceChars[i];
  }

  // Reuse array.
  var T = new Array(1024);

  export function escapeString(s: string): string {
    if (!needsEscaping(s)) {
      return s;
    }
    var l = s.length;
    var r = T;
    r.length = l;
    for (var i = 0; i < l; i++) {
      var c = s.charCodeAt(i);
      if (i === 0 && isDigit(c)) {
        r[i] = String.fromCharCode(c - 48 + 97); // Map 0 .. 9 to a .. j
      } else if (c < 128) {
        r[i] = map[c]
      } else {
        r[i] = s[i];
      }
    }
    return r.join("");
  }

  var stringHashes = Object.create(null);
  var stringHashCount = 0;

  function hashStringStrong(s): string {
    // Hash with Murmur hash.
    var result = StringUtilities.variableLengthEncodeInt32(hashString(s));
    // Also use the length for some more precision.
    result += StringUtilities.toEncoding(s.length & 0x3f);
    return result;
  }

  export function hashStringToString(s: string) {
    if (stringHashCount > 1024) {
      return hashStringStrong(s);
    }
    var c = stringHashes[s];
    if (c) {
      return c;
    }
    c = stringHashes[s] = hashStringStrong(s);
    stringHashCount ++;
    return c;
  }

  /**
   * This class is abstract and should never be initialized. It only acts as a template for
   * actual runtime objects.
   */
  export class RuntimeTemplate {
    static all = new Set();

    static isolateMap = Object.create(null);

    jvm: JVM;
    status: RuntimeStatus;
    waiting: any [];
    threadCount: number;
    initialized: any;
    pending: any;
    staticObjectAddresses: any;
    classObjectAddresses: any;
    ctx: Context;
    allCtxs: Set<Context>;

    isolateId: number;
    isolateAddress: number;
    priority: number = ISOLATE_NORM_PRIORITY;
    // XXX Rename mainThread to mainThreadAddress so it's clearly an address.
    mainThread: number;

    private static _nextRuntimeId: number = 0;
    private _runtimeId: number;
    private _nextHashCode: number;

    constructor(jvm: JVM) {
      this.jvm = jvm;
      this.status = RuntimeStatus.New;
      this.waiting = [];
      this.threadCount = 0;
      this.initialized = Object.create(null);
      this.pending = {};
      this.staticObjectAddresses = {};
      this.classObjectAddresses = {};
      this.ctx = null;
      this.allCtxs = new Set();
      this._runtimeId = RuntimeTemplate._nextRuntimeId ++;
      this._nextHashCode = this._runtimeId << 24;
    }
    
    preInitializeClasses(ctx: Context) {
      var prevCtx = $ ? $.ctx : null;
      var preInit = CLASSES.preInitializedClasses;
      ctx.setAsCurrentContext();
      for (var i = 0; i < preInit.length; i++) {
        preemptionLockLevel++;
        var classInfo = preInit[i];
        classInitCheck(classInfo);
        release || Debug.assert(!U, "Unexpected unwind during preInitializeClasses.");
        preemptionLockLevel-- ;
      }
      ctx.clearCurrentContext();
      if (prevCtx) {
        prevCtx.setAsCurrentContext();
      }
    }

    /**
     * After class initialization is finished the init9 method will invoke this so
     * any further initialize calls can be avoided. This isn't set on the first call
     * to a class initializer because there can be multiple calls into initialize from
     * different threads that need trigger the Class.initialize() code so they block.
     */
    setClassInitialized(classId: number) {
      var classInfo = classIdToClassInfoMap[classId];
      var className = classInfo.getClassNameSlow();
      this.initialized[className] = true;
    }

    getClassObjectAddress(classInfo: ClassInfo): number {
      if (!this.classObjectAddresses[classInfo.mangledName]) {
        var addr = allocObject(CLASSES.java_lang_Class);
        var handle = <java.lang.Class>getHandle(addr);
        handle.vmClass = classInfo.id;
        this.classObjectAddresses[classInfo.mangledName] = addr;
        linkWriter && linkWriter.writeLn("Initializing Class Object For: " + classInfo.getClassNameSlow());
        if (classInfo === CLASSES.java_lang_Object ||
            classInfo === CLASSES.java_lang_Class ||
            classInfo === CLASSES.java_lang_String ||
            classInfo === CLASSES.java_lang_Thread) {
          var handle = <java.lang.Class>getHandle(addr);
          handle.status = 4;
          this.setClassInitialized(classInfo.id);
        }
      }
      return this.classObjectAddresses[classInfo.mangledName];
    }

    getStaticObjectAddress(classInfo: ClassInfo): number {
      if (!this.staticObjectAddresses[classInfo.mangledName]) {
        $.staticObjectAddresses[classInfo.mangledName] = ASM._gcMalloc(J2ME.Constants.OBJ_HDR_SIZE + classInfo.sizeOfStaticFields);
      }
      return this.staticObjectAddresses[classInfo.mangledName];
    }

    /**
     * Generates a new hash code for the specified |object|.
     */
    nextHashCode(): number {
      return this._nextHashCode ++;
    }

    waitStatus(callback) {
      this.waiting.push(callback);
    }

    updateStatus(status: RuntimeStatus) {
      this.status = status;
      var waiting = this.waiting;
      this.waiting = [];
      waiting.forEach(function (callback) {
        try {
          callback();
        } catch (ex) {
          // If the callback calls Runtime.prototype.waitStatus to continue waiting,
          // then waitStatus will throw VM.Pause, which shouldn't propagate up to
          // the caller of Runtime.prototype.updateStatus, so we silently ignore it
          // (along with any other exceptions thrown by the callback, so they don't
          // propagate to the caller of updateStatus).
        }
      });
    }

    addContext(ctx) {
      ++this.threadCount;
      RuntimeTemplate.all.add(this);
      this.allCtxs.add(ctx);
    }

    removeContext(ctx) {
      if (!--this.threadCount) {
        RuntimeTemplate.all.delete(this);
        this.updateStatus(RuntimeStatus.Stopped);
      }
      this.allCtxs.delete(ctx);
    }

    newStringConstant(utf16ArrayAddr: number): number {
      var utf16Array = getArrayFromAddr(utf16ArrayAddr);
      var javaString = internedStrings.get(utf16Array);
      if (javaString !== null) {
        return javaString._address;
      }
      // It's ok to create and intern an object here, because we only return it
      // to ConstantPool.resolve, which itself is only called by a few callers,
      // which should be able to convert it into an address if needed.  But we
      // should confirm that all callers of ConstantPool.resolve really do that.
      javaString = <java.lang.String>getHandle(allocObject(CLASSES.java_lang_String));
      javaString.value = utf16ArrayAddr;
      javaString.offset = 0;
      javaString.count = utf16Array.length;
      internedStrings.put(utf16Array, javaString);
      return javaString._address;
    }

    newIOException(str?: string): java.io.IOException {
      return <java.io.IOException>$.ctx.createException(
        "java/io/IOException", str);
    }

    newUnsupportedEncodingException(str?: string): java.io.UnsupportedEncodingException {
      return <java.io.UnsupportedEncodingException>$.ctx.createException(
        "java/io/UnsupportedEncodingException", str);
    }

    newUTFDataFormatException(str?: string): java.io.UTFDataFormatException {
      return <java.io.UTFDataFormatException>$.ctx.createException(
        "java/io/UTFDataFormatException", str);
    }

    newSecurityException(str?: string): java.lang.SecurityException {
      return <java.lang.SecurityException>$.ctx.createException(
        "java/lang/SecurityException", str);
    }

    newIllegalThreadStateException(str?: string): java.lang.IllegalThreadStateException {
      return <java.lang.IllegalThreadStateException>$.ctx.createException(
        "java/lang/IllegalThreadStateException", str);
    }

    newRuntimeException(str?: string): java.lang.RuntimeException {
      return <java.lang.RuntimeException>$.ctx.createException(
        "java/lang/RuntimeException", str);
    }

    newIndexOutOfBoundsException(str?: string): java.lang.IndexOutOfBoundsException {
      return <java.lang.IndexOutOfBoundsException>$.ctx.createException(
        "java/lang/IndexOutOfBoundsException", str);
    }

    newArrayIndexOutOfBoundsException(str?: string): java.lang.ArrayIndexOutOfBoundsException {
      return <java.lang.ArrayIndexOutOfBoundsException>$.ctx.createException(
        "java/lang/ArrayIndexOutOfBoundsException", str);
    }

    newStringIndexOutOfBoundsException(str?: string): java.lang.StringIndexOutOfBoundsException {
      return <java.lang.StringIndexOutOfBoundsException>$.ctx.createException(
        "java/lang/StringIndexOutOfBoundsException", str);
    }

    newArrayStoreException(str?: string): java.lang.ArrayStoreException {
      return <java.lang.ArrayStoreException>$.ctx.createException(
        "java/lang/ArrayStoreException", str);
    }

    newIllegalMonitorStateException(str?: string): java.lang.IllegalMonitorStateException {
      return <java.lang.IllegalMonitorStateException>$.ctx.createException(
        "java/lang/IllegalMonitorStateException", str);
    }

    newClassCastException(str?: string): java.lang.ClassCastException {
      return <java.lang.ClassCastException>$.ctx.createException(
        "java/lang/ClassCastException", str);
    }

    newArithmeticException(str?: string): java.lang.ArithmeticException {
      return <java.lang.ArithmeticException>$.ctx.createException(
        "java/lang/ArithmeticException", str);
    }

    newClassNotFoundException(str?: string): java.lang.ClassNotFoundException {
      return <java.lang.ClassNotFoundException>$.ctx.createException(
        "java/lang/ClassNotFoundException", str);
    }

    newIllegalArgumentException(str?: string): java.lang.IllegalArgumentException {
      return <java.lang.IllegalArgumentException>$.ctx.createException(
        "java/lang/IllegalArgumentException", str);
    }

    newIllegalStateException(str?: string): java.lang.IllegalStateException {
      return <java.lang.IllegalStateException>$.ctx.createException(
        "java/lang/IllegalStateException", str);
    }

    newNegativeArraySizeException(str?: string): java.lang.NegativeArraySizeException {
      return <java.lang.NegativeArraySizeException>$.ctx.createException(
        "java/lang/NegativeArraySizeException", str);
    }

    newNullPointerException(str?: string): java.lang.NullPointerException {
      return <java.lang.NullPointerException>$.ctx.createException(
        "java/lang/NullPointerException", str);
    }

    newMediaException(str?: string): javax.microedition.media.MediaException {
      return <javax.microedition.media.MediaException>$.ctx.createException(
        "javax/microedition/media/MediaException", str);
    }

    newInstantiationException(str?: string): java.lang.InstantiationException {
      return <java.lang.InstantiationException>$.ctx.createException(
        "java/lang/InstantiationException", str);
    }

    newException(str?: string): java.lang.Exception {
      return <java.lang.Exception>$.ctx.createException(
        "java/lang/Exception", str);
    }

  }

  export enum VMState {
    Running = 0,
    Yielding = 1,
    Pausing = 2,
    Stopping = 3
  }

  export class Runtime extends RuntimeTemplate {
    private static _nextId: number = 0;
    id: number;

    /**
     * Bailout callback whenever a JIT frame is unwound.
     */
    B(pc: number, nextPC: number, local: any [], stack: any [], lockObject: java.lang.Object) {
      var methodInfo = jitMethodInfos[(<any>arguments.callee.caller).name];
      release || assert(methodInfo !== undefined);
      $.ctx.bailout(methodInfo, pc, nextPC, local, stack, lockObject);
    }

    /**
     * Bailout callback whenever a JIT frame is unwound that uses a slightly different calling
     * convetion that makes it more convenient to emit in some cases.
     */
    T(location: UnwindThrowLocation, local: any [], stack: any [], lockObject: java.lang.Object) {
      var methodInfo = jitMethodInfos[(<any>arguments.callee.caller).name];
      release || assert(methodInfo !== undefined);
      $.ctx.bailout(methodInfo, location.getPC(), location.getNextPC(), local, stack.slice(0, location.getSP()), lockObject);
    }

    yield(reason: string) {
      unwindCount ++;
      threadWriter && threadWriter.writeLn("yielding " + reason);
      runtimeCounter && runtimeCounter.count("yielding " + reason);
      U = VMState.Yielding;
      profile && $.ctx.pauseMethodTimeline();
    }

    pause(reason: string) {
      unwindCount ++;
      threadWriter && threadWriter.writeLn("pausing " + reason);
      runtimeCounter && runtimeCounter.count("pausing " + reason);
      U = VMState.Pausing;
      profile && $.ctx.pauseMethodTimeline();
    }

    stop() {
      U = VMState.Stopping;
    }

    constructor(jvm: JVM) {
      super(jvm);
      this.id = Runtime._nextId ++;
    }
  }

  export var klassIdMap = Object.create(null);
  export var classIdToClassInfoMap: Map<number, ClassInfo> = Object.create(null);

  export function getObjectClassId(addr: number) {
    release || assert(addr !== Constants.NULL);
    return i32[addr + Constants.OBJ_KLASS_ID_OFFSET >> 2];
  }

  /**
   * A map from addresses to monitors, which are JS objects that we use to track
   * the lock state of Java objects.
   *
   * In most cases, we create the JS objects via Object.create(null), but we use
   * java.lang.Class objects for classes, since those continue to be represented
   * by JS objects in the runtime.  We also overload this map to retrieve those
   * class objects for other purposes.
   *
   * XXX Consider storing lock state in the ASM heap.
   */
  export var monitorMap = Object.create(null);

  // XXX Figure out correct return type(s).
  export function getMonitor(ref: any): any {
    // An numerical reference is an address.
    if (typeof ref === "number") {
      return monitorMap[ref] || (monitorMap[ref] = Object.create(null));
    }

    // A java.lang.Class object is its own monitor.
    if (ref.classInfo === CLASSES.java_lang_Class) {
      debugger;
      return ref;
    }

    // An object with an _address property is a handle to a Java object.
    // XXX Also check that ref instanceof java.lang.Object?
    if ("_address" in ref) {
      release || assert(!("_lock" in ref), "monitor reference with _address doesn't have lock");
      return monitorMap[ref._address] || (monitorMap[ref._address] = Object.create(null));
    }

    // An object with a _lock property is itself a monitor.
    // XXX Seems dicey, warn or assert?
    if ("_lock" in ref) {
      return ref;
    }

    // Return the reference itself and hope for the best.
    release || assert(false, "monitor reference is unknown type");
    return ref;
  }

  /**
   * Representation of a Java class with JS object.
   */
  export interface Handle extends Function {
    new (address?: number): java.lang.Object;

    _address: number;
    classInfo: ClassInfo;
  }

  export class RuntimeClass {

    public _address: number;

    classInfo: ClassInfo;

    /**
     * Java class object. This is only available on runtime klasses and it points to itself. We go trough
     * this indirection in VM code for now so that we can easily change it later if we need to.
     */
    classObject: java.lang.Class;

    constructor(classInfo: ClassInfo) {
      this._address = ASM._gcMalloc(Constants.OBJ_HDR_SIZE + classInfo.sizeOfStaticFields);

      // XXX Should we set the ID of this instance to java.lang.Class's ID?
      // i32[this._address >> 2] = Klasses.java.lang.Class.id | 0;

      this.classInfo = classInfo;
    }
  }

  export class Lock {
    ready: Context [];
    waiting: Context [];

    constructor(public threadAddress: number, public level: number) {
      this.ready = [];
      this.waiting = [];
    }
  }

  /**
   * Registers the klass as a getter on the runtime template. On first access, the getter creates a runtime klass and
   * adds it to the runtime.
   */
  //export function registerKlass(klass: Klass, classInfo: ClassInfo) {
  //  linkWriter && linkWriter.writeLn("Registering Klass: " + classInfo.getClassNameSlow());
  //  Object.defineProperty(RuntimeTemplate.prototype, classInfo.mangledName, {
  //    configurable: true,
  //    get: function () {
  //      linkWriter && linkWriter.writeLn("Creating Runtime Klass: " + classInfo.getClassNameSlow());
  //      release || assert(!(klass instanceof RuntimeKlass));
  //      var runtimeKlass = new RuntimeKlass(klass);
  //      initializeClassObject(runtimeKlass);
  //      Object.defineProperty(this, classInfo.mangledName, {
  //        value: runtimeKlass
  //      });
  //      return runtimeKlass;
  //    }
  //  });
  //}

  var unresolvedSymbols = Object.create(null);

  //function findKlass(classInfo: ClassInfo) {
  //  if (unresolvedSymbols[classInfo.mangledName]) {
  //    return null;
  //  }
  //  var klass = jsGlobal[classInfo.mangledName];
  //  if (klass) {
  //    return klass;
  //  }
  //  return null;
  //}

  export function registerKlassSymbol(className: string) {
    throw new (<any>window).TODODERROR();
    //// TODO: This needs to be kept in sync to how mangleClass works.
    //var mangledName = mangleClassName(toUTF8(className));
    //if (RuntimeTemplate.prototype.hasOwnProperty(mangledName)) {
    //  return;
    //}
    //linkWriter && linkWriter.writeLn("Registering Klass Symbol: " + className);
    //if (!RuntimeTemplate.prototype.hasOwnProperty(mangledName)) {
    //  Object.defineProperty(RuntimeTemplate.prototype, mangledName, {
    //    configurable: true,
    //    get: function lazyKlass() {
    //      linkWriter && linkWriter.writeLn("Load Klass: " + className);
    //      CLASSES.loadAndLinkClass(className);
    //      return this[mangledName]; // This should not be recursive at this point.
    //    }
    //  });
    //}
    //
    //if (!jsGlobal.hasOwnProperty(mangledName)) {
    //  unresolvedSymbols[mangledName] = true;
    //  Object.defineProperty(jsGlobal, mangledName, {
    //    configurable: true,
    //    get: function () {
    //      linkWriter && linkWriter.writeLn("Load Klass: " + className);
    //      CLASSES.loadAndLinkClass(className);
    //      return this[mangledName]; // This should not be recursive at this point.
    //    }
    //  });
    //}
  }

  //export function registerKlassSymbols(classNames: string []) {
  //  for (var i = 0; i < classNames.length; i++) {
  //    var className = classNames[i];
  //    registerKlassSymbol(className);
  //  }
  //}
  //
  //function setKlassSymbol(mangledName: string, klass: Klass) {
  //  Object.defineProperty(jsGlobal, mangledName, {
  //    value: klass
  //  });
  //}

  function findNativeMethodBinding(methodInfo: MethodInfo) {
    var classBindings = BindingsMap.get(methodInfo.classInfo.utf8Name);
    if (classBindings && classBindings.native) {
      var method = classBindings.native[methodInfo.name + "." + methodInfo.signature];
      if (method) {
        return method;
      }
    }
    return null;
  }

  function reportError(method, key) {
    return function() {
      try {
        return method.apply(this, arguments);
      } catch (e) {
        // Filter JAVA exception and only report the native js exception, which
        // cannnot be handled properly by the JAVA code.
        if (!e.klass) {
          stderrWriter.errorLn("Native " + key + " throws: " + e);
        }
        throw e;
      }
    };
  }

  function findNativeMethodImplementation(methodInfo: MethodInfo) {
    // Look in bindings first.
    var binding = findNativeMethodBinding(methodInfo);
    if (binding) {
      return release ? binding : reportError(binding, methodInfo.implKey);
    }
    if (methodInfo.isNative) {
      var implKey = methodInfo.implKey;
      if (implKey in Native) {
        return release ? Native[implKey] : reportError(Native[implKey], implKey);
      } else {
        // Some Native MethodInfos are constructed but never called;
        // that's fine, unless we actually try to call them.
        return function missingImplementation() {
          stderrWriter.errorLn("implKey " + implKey + " is native but does not have an implementation.");
        }
      }
    }
    return null;
  }

  var frameView = new FrameView();

  //function findCompiledMethod(klass: Klass, methodInfo: MethodInfo): Function {
  //  // Use aotMetaData to find AOT methods instead of jsGlobal because runtime compiled methods may
  //  // be on the jsGlobal.
  //  var mangledClassAndMethodName = methodInfo.mangledClassAndMethodName;
  //  if (aotMetaData[mangledClassAndMethodName]) {
  //    aotMethodCount++;
  //    methodInfo.onStackReplacementEntryPoints = aotMetaData[methodInfo.mangledClassAndMethodName].osr;
  //    release || assert(jsGlobal[mangledClassAndMethodName], "function must be present when aotMetaData exists");
  //    return jsGlobal[mangledClassAndMethodName];
  //  }
  //  if (enableCompiledMethodCache) {
  //    var cachedMethod;
  //    if ((cachedMethod = CompiledMethodCache.get(methodInfo.implKey))) {
  //      cachedMethodCount ++;
  //      linkMethod(methodInfo, cachedMethod.source, cachedMethod.referencedClasses, cachedMethod.onStackReplacementEntryPoints);
  //    }
  //  }
  //
  //  return jsGlobal[mangledClassAndMethodName];
  //}

  /**
   * Creates convenience getters / setters on Java objects.
   */
  function linkHandleFields(handleConstructor, classInfo: ClassInfo) {
    var classBindings = BindingsMap.get(classInfo.utf8Name);
    if (classBindings && classBindings.fields) {
      release || assert(!classBindings.fields.staticSymbols, "Static fields are not supported yet");

      var instanceSymbols = classBindings.fields.instanceSymbols;

      for (var fieldName in instanceSymbols) {
        var fieldSignature = instanceSymbols[fieldName];

        var field = classInfo.getFieldByName(toUTF8(fieldName), toUTF8(fieldSignature), false);

        release || assert(!field.isStatic, "Static field was defined as instance in BindingsMap");
        var object = field.isStatic ? handleConstructor : handleConstructor.prototype;
        release || assert (!object.hasOwnProperty(fieldName), "Should not overwrite existing properties.");
        var getter;
        var setter;
        if (true || release) {
          switch (field.kind) {
            case Kind.Reference:
              setter = new Function("value", "i32[this._address + " + field.byteOffset + " >> 2] = value;");
              getter = new Function("return i32[this._address + " + field.byteOffset + " >> 2];");
              break;
            case Kind.Boolean:
              setter = new Function("value", "i32[this._address + " + field.byteOffset + " >> 2] = value ? 1 : 0;");
              getter = new Function("return i32[this._address + " + field.byteOffset + " >> 2];");
              break;
            case Kind.Byte:
            case Kind.Short:
            case Kind.Int:
              setter = new Function("value", "i32[this._address + " + field.byteOffset + " >> 2] = value;");
              getter = new Function("return i32[this._address + " + field.byteOffset + " >> 2];");
              break;
            case Kind.Float:
              setter = new Function("value", "f32[this._address + " + field.byteOffset + " >> 2] = value;");
              getter = new Function("return f32[this._address + " + field.byteOffset + " >> 2];");
              break;
            case Kind.Long:
              setter = new Function("value",
                                    "i32[this._address + " + field.byteOffset + " >> 2] = J2ME.numberToLong(value);" +
                                    "i32[this._address + " + field.byteOffset + " + 4 >> 2] = tempReturn0;");
              getter = new Function("return J2ME.longToNumber(i32[this._address + " + field.byteOffset + " >> 2]," +
                                    "                         i32[this._address + " + field.byteOffset + " + 4 >> 2]);");
              break;
            case Kind.Double:
              setter = new Function("value",
                                    "aliasedF64[0] = value;" +
                                    "i32[this._address + " + field.byteOffset + " >> 2] = aliasedI32[0];" +
                                    "i32[this._address + " + field.byteOffset + " + 4 >> 2] = aliasedI32[1];");
              getter = new Function("aliasedI32[0] = i32[this._address + " + field.byteOffset + " >> 2];" +
                                    "aliasedI32[1] = i32[this._address + " + field.byteOffset + " + 4 >> 2];" +
                                    "return aliasedF64[0];");
              break;
            default:
              Debug.assert(false, Kind[field.kind]);
              break;
          }
        } else {
          setter = FunctionUtilities.makeDebugForwardingSetter(field.mangledName, getKindCheck(field.kind));
        }
        Object.defineProperty(object, fieldName, {
          get: getter,
          set: setter,
          configurable: true,
          enumerable: false
        });
        delete instanceSymbols[fieldName];
      }

      if (!release) {
        if (classBindings.fields.staticSymbols) {
          var staticSymbolNames = Object.keys(classBindings.fields.staticSymbols);
          assert(staticSymbolNames.length === 0, "Unlinked symbols: " + staticSymbolNames.join(", "));
        }
        if (classBindings.fields.instanceSymbols) {
          var instanceSymbolNames = Object.keys(classBindings.fields.instanceSymbols);
          assert(instanceSymbolNames.length === 0, "Unlinked symbols: " + instanceSymbolNames.join(", "));
        }
      }
    }
  }

  function profilingWrapper(fn: Function, methodInfo: MethodInfo, methodType: MethodType) {
    if (methodType === MethodType.Interpreted) {
      // Profiling for interpreted functions is handled by the context.
      return fn;
    }
    var code;
    if (methodInfo.isNative) {
      if (methodInfo.returnKind === Kind.Void) {
        code = new Uint8Array([Bytecode.Bytecodes.RETURN]);
      } else if (isTwoSlot(methodInfo.returnKind)) {
        code = new Uint8Array([Bytecode.Bytecodes.LRETURN]);
      } else {
        code = new Uint8Array([Bytecode.Bytecodes.IRETURN]);
      }
    }


    return function (a, b, c, d) {
      var key = methodInfo.implKey;
      try {
        var ctx = $.ctx;
        ctx.enterMethodTimeline(key, methodType);
        var r;
        switch (arguments.length) {
          case 0:
            r = fn.call(this);
            break;
          case 1:
            r = fn.call(this, a);
            break;
          case 2:
            r = fn.call(this, a, b);
            break;
          case 3:
            r = fn.call(this, a, b, c);
            break;
          default:
            r = fn.apply(this, arguments);
        }
        if (U) {
          release || assert(ctx.paused, "context is paused");

          if (methodInfo.isNative) {
            // A fake frame that just returns is pushed so when the ctx resumes from the unwind
            // the frame will be popped triggering a leaveMethodTimeline.
            //REDUX
            //var fauxFrame = Frame.create(null, []);
            //fauxFrame.methodInfo = methodInfo;
            //fauxFrame.code = code;
            //ctx.bailoutFrames.unshift(fauxFrame);
          }
        } else {
          ctx.leaveMethodTimeline(key, methodType);
        }
      } catch (e) {
        ctx.leaveMethodTimeline(key, methodType);
        throw e;
      }
      return r;
    };
  }

  function tracingWrapper(fn: Function, methodInfo: MethodInfo, methodType: MethodType) {
    var wrapper = function() {
      // jsGlobal.getBacktrace && traceWriter.writeLn(jsGlobal.getBacktrace());
      var args = Array.prototype.slice.apply(arguments);
      traceWriter.enter("> " + MethodType[methodType][0] + " " + methodInfo.implKey);
      var s = performance.now();
      try {
        var value = fn.apply(this, args);
      } catch (e) {
        traceWriter.leave("< " + MethodType[methodType][0] + " Throwing");
        throw e;
      }
      traceWriter.leave("< " + MethodType[methodType][0] + " " + methodInfo.implKey);
      return value;
    };
    (<any>wrapper).methodInfo = methodInfo;
    return wrapper;
  }

  export function getLinkedMethod(methodInfo: MethodInfo) {
    if (methodInfo.fn) {
      return methodInfo.fn;
    }
    linkClassMethod(methodInfo.classInfo, methodInfo);
    release || assert (methodInfo.fn);
    return methodInfo.fn;
  }

  function linkClassMethod(classInfo: ClassInfo, methodInfo: MethodInfo) {
    runtimeCounter && runtimeCounter.count("linkClassMethod");
    var fn;
    var methodType;
    var nativeMethod = findNativeMethodImplementation(methodInfo);
    if (nativeMethod) {
      linkWriter && linkWriter.writeLn("Method: " + methodInfo.name + methodInfo.signature + " -> Native");
      fn = nativeMethod;
      methodType = MethodType.Native;
      methodInfo.state = MethodState.Compiled;
    } else {
      //fn = findCompiledMethod(klass, methodInfo);
      //if (fn) {
      //  linkWriter && linkWriter.greenLn("Method: " + methodInfo.name + methodInfo.signature + " -> Compiled");
      //  methodType = MethodType.Compiled;
      //  // Save method info so that we can figure out where we are bailing
      //  // out from.
      //  jitMethodInfos[fn.name] = methodInfo;
      //  methodInfo.state = MethodState.Compiled;
      //} else {
        linkWriter && linkWriter.warnLn("Method: " + methodInfo.name + methodInfo.signature + " -> Interpreter");
        methodType = MethodType.Interpreted;
        fn = prepareInterpretedMethod(methodInfo);
      //}
    }

    if (profile || traceWriter) {
      fn = wrapMethod(fn, methodInfo, methodType);
    }

    methodInfo.fn = fn;
    // REDUX
    //klass.M[methodInfo.index] = fn;

    //if (!methodInfo.isStatic && methodInfo.virtualName) {
    //  release || assert(klass.prototype.hasOwnProperty(methodInfo.virtualName));
    //  klass.prototype[methodInfo.virtualName] = fn;
    //  var classBindings = BindingsMap.get(klass.classInfo.utf8Name);
    //  if (classBindings && classBindings.methods && classBindings.methods.instanceSymbols) {
    //    var methodKey = classBindings.methods.instanceSymbols[methodInfo.name + "." + methodInfo.signature];
    //    if (methodKey) {
    //      klass.prototype[methodKey] = fn;
    //    }
    //  }
    //}
  }

  //function linkKlassMethods(klass: Klass) {
  //  var methods = klass.classInfo.getMethods();
  //  if (!methods) {
  //    return;
  //  }
  //  linkWriter && linkWriter.enter("Link Klass Methods: " + klass);
  //  var methods = klass.classInfo.getMethods();
  //
  //  var vTable = klass.classInfo.vTable;
  //  if (vTable) {
  //    // Eagerly install interface forwarders.
  //    for (var i = 0; i < vTable.length; i++) {
  //      var methodInfo = vTable[i];
  //      if (methodInfo.implementsInterface) {
  //        release || assert(methodInfo.mangledName);
  //        klass.prototype[methodInfo.mangledName] = makeInterfaceMethodForwarder(methodInfo.vTableIndex);
  //      }
  //    }
  //  }
  //
  //  linkWriter && linkWriter.outdent();
  //}

  //// Links the virtual method at a given index.
  //function linkVirtualMethodByIndex(self: java.lang.Object, index: number) {
  //  // Self is the object on which the trampoline is called. We want to figure
  //  // out the appropriate prototype object where we need to link the method. To
  //  // do this we look at self's class vTable, then find out the class of the
  //  // bound method and then call linkKlassMethod to patch it on the appropriate
  //  // prototype.
  //  var klass = self.klass;
  //  var classInfo = klass.classInfo;
  //  var methodInfo = classInfo.vTable[index];
  //  var methodKlass = methodInfo.classInfo.klass;
  //  linkKlassMethod(methodKlass, methodInfo);
  //  release || assert(methodInfo.fn);
  //  return methodInfo.fn;
  //}
  //
  //// Cache interface forwarders.
  //var interfaceMethodForwarders = new Array(256);
  //
  //// Creates a forwarder function that dispatches to a specified virtual
  //// name. These are used for interface dispatch.
  //function makeInterfaceMethodForwarder(index: number) {
  //  var forwarder = interfaceMethodForwarders[index];
  //  if (forwarder) {
  //    return forwarder;
  //  }
  //  runtimeCounter && runtimeCounter.count("makeInterfaceMethodForwarder");
  //  return interfaceMethodForwarders[index] = new Function("return this.v" + index + ".apply(this, arguments);");
  //}

  //// Cache virtual trampolines.
  //var virtualMethodTrampolines = new Array(256);
  //
  //// Creates a reusable trampoline function for a given index in the vTable.
  //function makeVirtualMethodTrampoline(index: number) {
  //  var trampoline = virtualMethodTrampolines[index];
  //  if (trampoline) {
  //    return trampoline;
  //  }
  //  runtimeCounter && runtimeCounter.count("makeVirtualMethodTrampoline");
  //  return virtualMethodTrampolines[index] = function vTrampoline() {
  //    return linkVirtualMethodByIndex(this, index).apply(this, arguments);
  //  };
  //}
  //
  //function linkMethodByIndex(klass: Klass, index: number) {
  //  var methodInfo = klass.classInfo.getMethodByIndex(index);
  //  linkKlassMethod(klass, methodInfo);
  //  release || assert(methodInfo.fn);
  //  return methodInfo.fn;
  //}
  //
  //function makeMethodTrampoline(klass: Klass, index: number) {
  //  runtimeCounter && runtimeCounter.count("makeMethodTrampoline");
  //  return function () {
  //    return linkMethodByIndex(klass, index).apply(this, arguments);
  //  };
  //}

  //// Inserts trampolines for virtual methods on prototype objects whenever new methods
  //// are defined. Inherited methods don't need trampolines since they already have them
  //// in the super class prototypes.
  //function initializeKlassVirtualMethodTrampolines(classInfo: ClassInfo, klass: Klass) {
  //  var vTable = classInfo.vTable;
  //  for (var i = 0; i < vTable.length; i++) {
  //    if (vTable[i].classInfo === classInfo) {
  //      runtimeCounter && runtimeCounter.count("fillTrampoline");
  //      // TODO: Uncomment this assertion. Array prototype has Object prototype on the
  //      // prototype hierarchy, and trips this assert since it already has the virtual
  //      // trampolines installed.
  //      // assert (!klass.prototype.hasOwnProperty("v" + i));
  //      klass.prototype["v" + i] = makeVirtualMethodTrampoline(i);
  //    }
  //  }
  //}
  //
  //function initializeKlassMethodTrampolines(classInfo: ClassInfo, klass: Klass) {
  //  var count = classInfo.getMethodCount();
  //  for (var i = 0; i < count; i++) {
  //    klass["m" + i] = makeMethodTrampoline(klass, i);
  //  }
  //}

  //function klassMethodLink(index: number) {
  //  var klass: Klass = this;
  //  var fn = klass.M[index];
  //  if (fn) {
  //    return fn;
  //  }
  //  linkKlassMethod(klass, klass.classInfo.getMethodByIndex(index));
  //  release || assert(klass.M[index], "Method should be linked now.");
  //  return klass.M[index];
  //}

  //function klassResolveConstantPoolEntry(index: number) {
  //  var klass: Klass = this;
  //  return klass.classInfo.constantPool.resolve(index, TAGS.CONSTANT_Any);
  //}

  /**
   * Number of methods that have been compiled thus far.
   */
  export var compiledMethodCount = 0;

  /**
   * Number of methods that have not been compiled thus far.
   */
  export var notCompiledMethodCount = 0;

  /**
   * Number of methods that have been loaded from the code cache thus far.
   */
  export var cachedMethodCount = 0;

  /**
   * Number of methods that have been loaded from ahead of time compiled code thus far.
   */
  export var aotMethodCount = 0;

  /**
   * Number of ms that have been spent compiled code thus far.
   */
  var totalJITTime = 0;

  /**
   * Compiles method and links it up at runtime.
   */
  export function compileAndLinkMethod(methodInfo: MethodInfo) {
    return;
    //// Don't do anything if we're past the compiled state.
    //if (methodInfo.state >= MethodState.Compiled) {
    //  return;
    //}
    //
    //// Don't compile methods that are too large.
    //if (methodInfo.codeAttribute.code.length > 4000 && !config.forceRuntimeCompilation) {
    //  jitWriter && jitWriter.writeLn("Not compiling: " + methodInfo.implKey + " because it's too large. " + methodInfo.codeAttribute.code.length);
    //  methodInfo.state = MethodState.NotCompiled;
    //  notCompiledMethodCount ++;
    //  return;
    //}
    //
    //if (enableCompiledMethodCache) {
    //  var cachedMethod;
    //  if (cachedMethod = CompiledMethodCache.get(methodInfo.implKey)) {
    //    cachedMethodCount ++;
    //    jitWriter && jitWriter.writeLn("Getting " + methodInfo.implKey + " from compiled method cache");
    //    return linkMethod(methodInfo, cachedMethod.source, cachedMethod.referencedClasses, cachedMethod.onStackReplacementEntryPoints);
    //  }
    //}
    //
    //var mangledClassAndMethodName = methodInfo.mangledClassAndMethodName;
    //
    //jitWriter && jitWriter.enter("Compiling: " + methodInfo.implKey + ", currentBytecodeCount: " + methodInfo.stats.bytecodeCount);
    //var s = performance.now();
    //
    //var compiledMethod;
    //enterTimeline("Compiling");
    //try {
    //  compiledMethod = baselineCompileMethod(methodInfo, CompilationTarget[enableCompiledMethodCache ? "Static" : "Runtime"]);
    //  compiledMethodCount ++;
    //} catch (e) {
    //  methodInfo.state = MethodState.CannotCompile;
    //  jitWriter && jitWriter.writeLn("Cannot compile: " + methodInfo.implKey + " because of " + e);
    //  leaveTimeline("Compiling");
    //  return;
    //}
    //leaveTimeline("Compiling");
    //var compiledMethodName = mangledClassAndMethodName;
    //var source = "function " + compiledMethodName +
    //             "(" + compiledMethod.args.join(",") + ") {\n" +
    //               compiledMethod.body +
    //             "\n}";
    //
    //codeWriter && codeWriter.writeLns(source);
    //var referencedClasses = compiledMethod.referencedClasses.map(function(v) { return v.getClassNameSlow() });
    //
    //if (enableCompiledMethodCache) {
    //  CompiledMethodCache.put({
    //    key: methodInfo.implKey,
    //    source: source,
    //    referencedClasses: referencedClasses,
    //    onStackReplacementEntryPoints: compiledMethod.onStackReplacementEntryPoints
    //  });
    //}
    //
    //linkMethod(methodInfo, source, referencedClasses, compiledMethod.onStackReplacementEntryPoints);
    //
    //var methodJITTime = (performance.now() - s);
    //totalJITTime += methodJITTime;
    //if (jitWriter) {
    //  jitWriter.leave(
    //    "Compilation Done: " + methodJITTime.toFixed(2) + " ms, " +
    //    "codeSize: " + methodInfo.codeAttribute.code.length + ", " +
    //    "sourceSize: " + compiledMethod.body.length);
    //  jitWriter.writeLn("Total: " + totalJITTime.toFixed(2) + " ms");
    //}
  }

  function wrapMethod(fn, methodInfo: MethodInfo, methodType: MethodType) {
    if (profile) {
      fn = profilingWrapper(fn, methodInfo, methodType);
    }

    if (traceWriter) {
      fn = tracingWrapper(fn, methodInfo, methodType);
    }
    return fn;
  }

  ///**
  // * Links up compiled method at runtime.
  // */
  //export function linkMethod(methodInfo: MethodInfo, source: string, referencedClasses: string[], onStackReplacementEntryPoints: any) {
  //  jitWriter && jitWriter.writeLn("Link method: " + methodInfo.implKey);
  //
  //  enterTimeline("Eval Compiled Code");
  //  // This overwrites the method on the global object.
  //  (1, eval)(source);
  //  leaveTimeline("Eval Compiled Code");
  //
  //  var mangledClassAndMethodName = methodInfo.mangledClassAndMethodName;
  //  var fn = jsGlobal[mangledClassAndMethodName];
  //  if (profile || traceWriter) {
  //    fn = wrapMethod(fn, methodInfo, MethodType.Compiled);
  //  }
  //  var klass = methodInfo.classInfo.klass;
  //  klass.M[methodInfo.index] = methodInfo.fn = fn;
  //  methodInfo.state = MethodState.Compiled;
  //  methodInfo.onStackReplacementEntryPoints = onStackReplacementEntryPoints;
  //
  //  // Link member methods on the prototype.
  //  if (!methodInfo.isStatic && methodInfo.virtualName) {
  //    klass.prototype[methodInfo.virtualName] = fn;
  //  }
  //
  //  // Make JITed code available in the |jitMethodInfos| so that bailout
  //  // code can figure out the caller.
  //  jitMethodInfos[mangledClassAndMethodName] = methodInfo;
  //
  //  // Make sure all the referenced symbols are registered.
  //  for (var i = 0; i < referencedClasses.length; i++) {
  //    registerKlassSymbol(referencedClasses[i]);
  //  }
  //}

  export function isAssignableTo(from: ClassInfo, to: ClassInfo): boolean {
    return from.isAssignableTo(to);
  }

  export function instanceOfKlass(object: java.lang.Object, classInfo: ClassInfo): boolean {
    return object !== null && isAssignableTo(object.classInfo, classInfo);
  }

  export function instanceOfInterface(object: java.lang.Object, classInfo: ClassInfo): boolean {
    release || assert(classInfo.isInterface);
    return object !== null && isAssignableTo(object.classInfo, classInfo);
  }

  export function checkCastKlass(object: java.lang.Object, classInfo: ClassInfo) {
    if (object !== null && !isAssignableTo(object.classInfo, classInfo)) {
      throw $.newClassCastException();
    }
  }

  export function checkCastInterface(object: java.lang.Object, classInfo: ClassInfo) {
    if (object !== null && !isAssignableTo(object.classInfo, classInfo)) {
      throw $.newClassCastException();
    }
  }

  export function newObject(classInfo: ClassInfo): java.lang.Object {
    throw new (<any>window).TODOERROR();
    //return new klass();
  }

  export function allocObject(classInfo: ClassInfo): number {
    var address = ASM._gcMalloc(Constants.OBJ_HDR_SIZE + classInfo.sizeOfFields);
    i32[address >> 2] = classInfo.id | 0;
    return address;
  }


  var handleConstructors = Object.create(null);

  /**
   * Get a handle for an object in the ASM heap.
   *
   * Currently, we implement this using JS constructors (i.e. Klass instances)
   * with a prototype chain that reflects the Java class hierarchy and getters/
   * setters for fields.
   */
  export function getHandle(address: number): java.lang.Object {
    if (address === Constants.NULL) {
      return null;
    }

    release || assert(typeof address === "number", "address is number");

    var classId = i32[address + Constants.OBJ_KLASS_ID_OFFSET >> 2];
    release || assert(typeof classId === "number", "classId is number");

    var classInfo = classIdToClassInfoMap[classId];
    release || assert(classInfo, "object has class info");

    if (classInfo.elementClass) {
      return getArrayFromAddr(address);
    }

    if (!handleConstructors[classId]) {
      //writer.writeLn("if (address) {");
      //writer.writeLn("  this._address = address;");
      //// writer.writeLn("  this._hashCode = i32[this._address + " + Constants.HASH_CODE_OFFSET + " >> 2];");
      //writer.writeLn("} else {");
      //writer.writeLn("  this._address = ASM._gcMalloc(" + (Constants.OBJ_HDR_SIZE + classInfo.sizeOfFields) + ");");
      //writer.writeLn("  i32[this._address >> 2] = " + klassId + " | 0;");
      //// writer.writeLn("  this._hashCode = i32[this._address + " + Constants.HASH_CODE_OFFSET + " >> 2] = $.nextHashCode();");
      //writer.writeLn("  this._hashCode = i32[this._address + 4 >> 2] = 0;");
      //writer.writeLn("}");

      var constructor = function(address) {
        this._address = address;
      };
      constructor.prototype.classInfo = classInfo;
      linkHandleFields(constructor, classInfo);
      // Link the field bindings.
      handleConstructors[classId] = constructor;
    }
    return new handleConstructors[classId](address);
  }

  export function newString(jsString: string): number {
    if (jsString === null || jsString === undefined) {
      return Constants.NULL;
    }
    var object = <java.lang.String>getHandle(allocObject(CLASSES.java_lang_String));
    object.value = util.stringToCharArray(jsString);
    object.offset = 0;
    object.count = getArrayFromAddr(object.value).length;
    return object._address;
  }

  export var arrayMap = Object.create(null);

  export function getArrayFromAddr(addr: number) {
    if (addr === Constants.NULL) {
      return null;
    }

    release || assert(typeof addr === "number", "addr is number");
    var classInfo = classIdToClassInfoMap[getObjectClassId(addr)];
    var constructor;
    if (classInfo instanceof PrimitiveArrayClassInfo) {
      switch (classInfo) {
        case PrimitiveArrayClassInfo.Z:
          constructor = Uint8Array;
          break;
        case PrimitiveArrayClassInfo.C:
          constructor = Uint16Array;
          break;
        case PrimitiveArrayClassInfo.F:
          constructor = Float32Array;
          break;
        case PrimitiveArrayClassInfo.D:
          constructor = Float64Array;
          break;
        case PrimitiveArrayClassInfo.B:
          constructor = Int8Array;
          break;
        case PrimitiveArrayClassInfo.S:
          constructor = Int16Array;
          break;
        case PrimitiveArrayClassInfo.I:
          constructor = Int32Array;
          break;
        case PrimitiveArrayClassInfo.J:
          constructor = Int64Array;
          break;
        default:
          Debug.assertUnreachable("Bad primitive array" + classInfo.getClassNameSlow());
          break;
      }
    } else {
      constructor = Int32Array;
    }
    constructor.prototype.classInfo = classInfo;
    return new constructor(ASM.buffer, Constants.ARRAY_HDR_SIZE + addr, i32[addr + Constants.ARRAY_LENGTH_OFFSET >> 2]);
  }

  export function newArray(elementClassInfo: ClassInfo, size: number): number {
    release || assert(elementClassInfo instanceof ClassInfo);
    if (size < 0) {
      throwNegativeArraySizeException();
    }

    var arrayClassInfo = CLASSES.getClass("[" + elementClassInfo.getClassNameSlow());
    var addr;

    if (elementClassInfo instanceof PrimitiveClassInfo) {
      addr = ASM._gcMallocAtomic(Constants.ARRAY_HDR_SIZE + size * (<PrimitiveArrayClassInfo>arrayClassInfo).bytesPerElement);
    } else {
      // We need to hold an integer to define the length of the array
      // and *size* references.
      addr = ASM._gcMalloc(Constants.ARRAY_HDR_SIZE + size * 4);
    }

    i32[addr + Constants.OBJ_KLASS_ID_OFFSET >> 2] = arrayClassInfo.id;
    i32[addr + Constants.ARRAY_LENGTH_OFFSET >> 2] = size;

    return addr;
  }
  
  export function newMultiArray(classInfo: ClassInfo, lengths: number[]): number {
    var length = lengths[0];
    var arrayAddr = newArray(classInfo.elementClass, length);
    var array = arrayMap[arrayAddr];
    if (lengths.length > 1) {
      lengths = lengths.slice(1);
      for (var i = 0; i < length; i++) {
        array[i] = newMultiArray(classInfo.elementClass, lengths);
      }
    }
    return arrayAddr;
  }

  export var JavaRuntimeException = function(message) {
    this.message = message;
  };

  JavaRuntimeException.prototype = Object.create(Error.prototype);
  JavaRuntimeException.prototype.name = "JavaRuntimeException";
  JavaRuntimeException.prototype.constructor = JavaRuntimeException;

  export function throwNegativeArraySizeException() {
    throw $.newNegativeArraySizeException();
  }

  export function throwNullPointerException() {
    throw $.newNullPointerException();
  }

  export function newObjectArray(size: number): number {
    return newArray(CLASSES.java_lang_Object, size);
  }

  export function newStringArray(size: number): number {
    return newArray(CLASSES.java_lang_String, size);
  }

  export function newByteArray(size: number): number {
    return newArray(PrimitiveClassInfo.B, size);
  }

  export function newCharArray(size: number): number {
    return newArray(PrimitiveClassInfo.C, size);
  }

  export function newIntArray(size: number): number {
    return newArray(PrimitiveClassInfo.I, size);
  }

  //export function getArrayKlass(elementKlass: Klass): Klass {
  //  throw (<any>window).TODOERROR();
  //  //// Have we already created one? We need to maintain pointer identity.
  //  //if (elementKlass.arrayKlass) {
  //  //  return elementKlass.arrayKlass;
  //  //}
  //  //var className = elementKlass.classInfo.getClassNameSlow();
  //  //if (!(elementKlass.classInfo instanceof PrimitiveClassInfo) && className[0] !== "[") {
  //  //  className = "L" + className + ";";
  //  //}
  //  //className = "[" + className;
  //  //return getKlass(CLASSES.getClass(className));
  //}

  export function toDebugString(value: any): string {
    if (typeof value !== "object") {
      return String(value);
    }
    if (value === undefined) {
      return "undefined";
    }
    if (!value) {
      return "null";
    }
    if (!value.klass) {
      return "no klass";
    }
    if (!value.klass.classInfo) {
      return value.klass + " no classInfo"
    }
    var hashcode = "";
    if (value._hashCode) {
      hashcode = " 0x" + value._hashCode.toString(16).toUpperCase();
    }
    if (value instanceof Klasses.java.lang.String) {
      return "\"" + value.str + "\"";
    }
    return "[" + value.klass.classInfo.getClassNameSlow() + hashcode + "]";
  }

  export function fromStringAddr(stringAddr: number): string {
    if (stringAddr === Constants.NULL) {
      return null;
    }

    // XXX Retrieve the characters directly from memory, without indirecting
    // through getHandle and getArrayFromAddr.
    var javaString = <java.lang.String>getHandle(stringAddr);
    return util.fromJavaChars(getArrayFromAddr(javaString.value), javaString.offset, javaString.count);
  }

  export function checkDivideByZero(value: number) {
    if (value === 0) {
      throwArithmeticException();
    }
  }

  export function checkDivideByZeroLong(value: Long) {
    if (value.isZero()) {
      throwArithmeticException();
    }
  }

  /**
   * Do bounds check using only one branch. The math works out because array.length
   * can't be larger than 2^31 - 1. So |index| >>> 0 will be larger than
   * array.length if it is less than zero. We need to make the right side unsigned
   * as well because otherwise the SM optimization that converts this to an
   * unsinged branch doesn't kick in.
   */
  export function checkArrayBounds(array: any [], index: number) {
    // XXX: This function is unused, should be updated if we're
    // ever going to use it
    if ((index >>> 0) >= (array.length >>> 0)) {
      throw $.newArrayIndexOutOfBoundsException(String(index));
    }
  }

  export function throwArrayIndexOutOfBoundsException(index: number) {
    throw $.newArrayIndexOutOfBoundsException(String(index));
  }

  export function throwArithmeticException() {
    throw $.newArithmeticException("/ by zero");
  }

  export function checkArrayStore(arrayAddr: number, valueAddr: number) {
    if (valueAddr === Constants.NULL) {
      return;
    }

    var arrayKlass = klassIdMap[i32[arrayAddr + Constants.OBJ_KLASS_ID_OFFSET >> 2]];
    var valueKlass = klassIdMap[i32[valueAddr + Constants.OBJ_KLASS_ID_OFFSET >> 2]];

    if (!isAssignableTo(valueKlass, arrayKlass.elementKlass)) {
      throw $.newArrayStoreException();
    }
  }

  export function checkNull(object: java.lang.Object) {
    if (!object) {
      throw $.newNullPointerException();
    }
  }

  export enum Constants {
    BYTE_MIN = -128,
    BYTE_MAX = 127,
    SHORT_MIN = -32768,
    SHORT_MAX = 32767,
    CHAR_MIN = 0,
    CHAR_MAX = 65535,
    INT_MIN = -2147483648,
    INT_MAX =  2147483647,

    LONG_MAX_LOW = 0xFFFFFFFF,
    LONG_MAX_HIGH = 0x7FFFFFFF,

    LONG_MIN_LOW = 0,
    LONG_MIN_HIGH = 0x80000000,

    TWO_PWR_32_DBL = 4294967296,

    // The size in bytes of the header in the memory allocated to the object.
    OBJ_HDR_SIZE = 8,

    // The offset in bytes from the beginning of the allocated memory
    // to the location of the klass id.
    OBJ_KLASS_ID_OFFSET = 0,
    // The offset in bytes from the beginning of the allocated memory
    // to the location of the hash code.
    HASH_CODE_OFFSET = 4,

    ARRAY_HDR_SIZE = 8,

    ARRAY_LENGTH_OFFSET = 4,
    NULL = 0,
  }

  export function monitorEnter(object: J2ME.java.lang.Object) {
    $.ctx.monitorEnter(object);
  }

  export function monitorExit(object: J2ME.java.lang.Object) {
    $.ctx.monitorExit(object);
  }

  export function translateException(e) {
    if (e.name === "TypeError") {
      // JavaScript's TypeError is analogous to a NullPointerException.
      return $.newNullPointerException(e.message);
    } else if (e.name === "JavaRuntimeException") {
      return $.newRuntimeException(e.message);
    }
    return e;
  }

  export function classInitCheck(classInfo: ClassInfo) {
    if (classInfo instanceof ArrayClassInfo || $.initialized[classInfo.getClassNameSlow()]) {
      return;
    }
    // TODO: make this more efficient when we decide on how to invoke code.
    getLinkedMethod(CLASSES.java_lang_Class.getMethodByNameString("initialize", "()V"))($.getClassObjectAddress(classInfo));
  }

  export function preempt() {
    if (Scheduler.shouldPreempt()) {
      $.yield("preemption");
    }
  }

  export class UnwindThrowLocation {
    static instance: UnwindThrowLocation = new UnwindThrowLocation();
    pc: number;
    sp: number;
    nextPC: number;
    constructor() {
      this.pc = 0;
      this.sp = 0;
      this.nextPC = 0;
    }
    setLocation(pc: number, nextPC: number, sp: number) {
      this.pc = pc;
      this.sp = sp;
      this.nextPC = nextPC;
      return this;
    }
    getPC() {
      return this.pc;
    }
    getSP() {
      return this.sp;
    }
    getNextPC() {
      return this.nextPC;
    }
  }

  /**
   * Generic unwind throw.
   */
  export function throwUnwind(pc: number, nextPC: number = pc + 3, sp: number = 0) {
    throw UnwindThrowLocation.instance.setLocation(pc, nextPC, sp);
  }

  /**
   * Unwind throws with different stack heights. This is useful so we can
   * save a few bytes encoding the stack height in the function name.
   */
  export function throwUnwind0(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 0);
  }

  export function throwUnwind1(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 1);
  }

  export function throwUnwind2(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 2);
  }

  export function throwUnwind3(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 3);
  }

  export function throwUnwind4(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 4);
  }

  export function throwUnwind5(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 5);
  }

  export function throwUnwind6(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 6);
  }

  export function throwUnwind7(pc: number, nextPC: number = pc + 3) {
    throwUnwind(pc, nextPC, 7);
  }
}

var Runtime = J2ME.Runtime;

var AOTMD = J2ME.aotMetaData;

/**
 * Are we currently unwinding the stack because of a Yield? This technically
 * belonges to a context but we store it in the global object because it is
 * read very often.
 */
var U: J2ME.VMState = J2ME.VMState.Running;

// To enable breaking when it is set in Chrome, define it as a getter/setter:
// http://stackoverflow.com/questions/11618278/how-to-break-on-property-change-in-chrome
// var _U: J2ME.VMState = J2ME.VMState.Running;
// declare var U;
// Object.defineProperty(jsGlobal, 'U', {
//     get: function () {
//         return jsGlobal._U;
//     },
//     set: function (value) {
//         jsGlobal._U = value;
//     }
// });

// Several unwind throws for different stack heights.

var B0 = J2ME.throwUnwind0;
var B1 = J2ME.throwUnwind1;
var B2 = J2ME.throwUnwind2;
var B3 = J2ME.throwUnwind3;
var B4 = J2ME.throwUnwind4;
var B5 = J2ME.throwUnwind5;
var B6 = J2ME.throwUnwind6;
var B7 = J2ME.throwUnwind7;

/**
 * OSR Frame.
 */
// REDUX
var O = null;

/**
 * Runtime exports for compiled code.
 * DO NOT use these short names outside of compiled code.
 */
var IOK = J2ME.instanceOfKlass;
var IOI = J2ME.instanceOfInterface;

var CCK = J2ME.checkCastKlass;
var CCI = J2ME.checkCastInterface;

//var AK = J2ME.getArrayKlass;

// XXX These (or their callers) will need to be updated to handle addresses.
var NA = J2ME.newArray;
var NM = J2ME.newMultiArray;

var CDZ = J2ME.checkDivideByZero;
var CDZL = J2ME.checkDivideByZeroLong;

var CAB = J2ME.checkArrayBounds;
var CAS = J2ME.checkArrayStore;

// XXX Ensure these work with new monitor objects.
var ME = J2ME.monitorEnter;
var MX = J2ME.monitorExit;

var TE = J2ME.translateException;
var TI = J2ME.throwArrayIndexOutOfBoundsException;
var TA = J2ME.throwArithmeticException;
var TN = J2ME.throwNegativeArraySizeException;

var PE = J2ME.preempt;
var PS = 0; // Preemption samples.

var getHandle = J2ME.getHandle;

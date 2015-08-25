var J2ME = {
  ArrayUtilities: {
    makeArrays: function(length) {
      var arrays = [];
      for (var i = 0; i < length; i++) {
        arrays.push(new Array(i));
      }
      return arrays;
    }
  }
};

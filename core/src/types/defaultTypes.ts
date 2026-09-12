// Auto-derived from core/assets/types.json
export const defaultTypesCatalog = {
  "bool": {
    "name": "Boolean",
    "description": "A boolean value that can be either true or false",
    "as_arg_compatible_with": [
      "i8",
      "u8",
      "i16",
      "u16",
      "i32",
      "u32",
      "i64",
      "u64",
      "f32",
      "f64"
    ]
  },
  "i8": {
    "name": "Signed 8-bit Integer",
    "description": "A signed integer value that can hold values from -128 to 127",
    "as_arg_compatible_with": [
      "bool"
    ]
  },
  "u8": {
    "name": "Unsigned 8-bit Integer",
    "description": "An unsigned integer value that can hold values from 0 to 255",
    "as_arg_compatible_with": [
      "bool"
    ]
  },
  "i16": {
    "name": "Signed 16-bit Integer",
    "description": "A signed integer value that can hold values from -32768 to 32767",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8"
    ]
  },
  "u16": {
    "name": "Unsigned 16-bit Integer",
    "description": "An unsigned integer value that can hold values from 0 to 65535",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8"
    ]
  },
  "i32": {
    "name": "Signed 32-bit Integer",
    "description": "A signed integer value that can hold values from -2147483648 to 2147483647",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8",
      "i16",
      "u16"
    ]
  },
  "u32": {
    "name": "Unsigned 32-bit Integer",
    "description": "An unsigned integer value that can hold values from 0 to 4294967295",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8",
      "i16",
      "u16"
    ]
  },
  "i64": {
    "name": "Signed 64-bit Integer",
    "description": "A signed integer value that can hold values from -9223372036854775808 to 9223372036854775807",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8",
      "i16",
      "u16",
      "i32",
      "u32"
    ]
  },
  "u64": {
    "name": "Unsigned 64-bit Integer",
    "description": "An unsigned integer value that can hold values from 0 to 18446744073709551615",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8",
      "i16",
      "u16",
      "i32",
      "u32"
    ]
  },
  "f32": {
    "name": "32-bit Floating Point Number",
    "description": "A floating point value that can hold values from approximately -3.40282347e+38 to 3.40282347e+38",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8",
      "i16",
      "u16",
      "i32",
      "u32",
      "i64",
      "u64"
    ]
  },
  "f64": {
    "name": "64-bit Floating Point Number",
    "description": "A floating point value that can hold values from approximately -1.7976931348623157e+308 to 1.7976931348623157e+308",
    "as_arg_compatible_with": [
      "bool",
      "i8",
      "u8",
      "i16",
      "u16",
      "i32",
      "u32",
      "i64",
      "u64"
    ]
  },
  "pss": {
    "name": "Push stream",
    "description": "A stream of data that can be pushed to",
    "params": {
      "T": {
        "name": "Push stream type"
      }
    }
  },
  "array": {
    "name": "Array",
    "description": "An array of values",
    "params": {
      "T": {
        "name": "Array component type"
      }
    }
  }
} as const;

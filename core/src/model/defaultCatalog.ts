/**
 * @title Default Catalog
 */
// Auto-derived from core/assets catalog JSON files
import { defaultTypesCatalog } from "../types";
export { defaultTypesCatalog };


export const defaultNamespacesCatalog = {
  "base": {
    "name": "Base",
    "icon": "base-ns.svg",
    "description": "Base namespace",
    "children": {
      "runtime": {
        "name": "Runtime",
        "icon": "base.runtime-ns.svg",
        "description": "Runtime namespace"
      }
    }
  },
  "push": {
    "name": "Push Dataflows",
    "icon": "push-ns.svg",
    "description": "Push Dataflows",
    "children": {
      "f32": {
        "name": "Single precision",
        "icon": "push.f32-ns.svg",
        "description": "Single precision push dataflows",
        "children": {
          "transformers": {
            "name": "Transformers",
            "icon": "push.transformers-ns.svg",
            "description": "Transformers"
          },
          "sources": {
            "name": "Sources",
            "icon": "push.sources-ns.svg",
            "description": "Sources"
          },
          "sinks": {
            "name": "Sinks",
            "icon": "push.sinks-ns.svg",
            "description": "Sinks"
          }
        }
      }
    }
  }
} as const;

export const defaultBlocksCatalog = {
  "cos_f32": {
    "ns": [
      "push",
      "f32",
      "transformers"
    ],
    "icon": "cos.svg",
    "title": "cos",
    "description": "Computes the cosine of the input value",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "outputs": {
      "cos": {
        "vector": false,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    }
  },
  "sin_f32": {
    "ns": [
      "push",
      "f32",
      "transformers"
    ],
    "icon": "sin.svg",
    "title": "sin",
    "description": "Computes the sine of the input value",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "outputs": {
      "sin": {
        "vector": false,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    }
  },
  "scope_f32": {
    "ns": [
      "push",
      "f32",
      "sinks"
    ],
    "icon": "scope.svg",
    "title": "Scope",
    "description": "Displays the input values in a scope",
    "outputs": {
      "sink": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "conf": {
      "period": {
        "type": {
          "raw": "u32"
        },
        "control": {
          "type": "slider",
          "default": 60,
          "min": 10,
          "max": 600,
          "unit": "s"
        }
      },
      "precision": {
        "type": {
          "raw": "u32"
        },
        "control": {
          "type": "slider",
          "default": 10,
          "min": 1,
          "max": 1000,
          "unit": "ms"
        }
      }
    }
  },
  "product_f32": {
    "ns": [
      "push",
      "f32",
      "transformers"
    ],
    "icon": "product.svg",
    "title": "Product",
    "description": "Computes the product of the input values",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "outputs": {
      "p": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    }
  },
  "gpio_in": {
    "ns": [
      "push",
      "gpio",
      "sources"
    ],
    "icon": "push.gpio_in.svg",
    "title": "GPIO Input",
    "description": "Reads the input value from a GPIO pin",
    "inputs": {
      "pin": {
        "vector": false,
        "type": {
          "raw": "array",
          "args": {
            "T": {
              "raw": "pss",
              "args": {
                "T": {
                  "raw": "f32"
                }
              }
            }
          }
        },
        "concept": {
          "length": {
            "bind": {
              "type": "conf",
              "id": "pins",
              "control": {
                "length": {
                  "kind": "eq"
                }
              }
            }
          },
          "args": {
            "T": {
              "vector": true
            }
          }
        }
      }
    },
    "conf": {
      "pins": {
        "type": {
          "raw": "array",
          "args": {
            "T": {
              "raw": "u8"
            }
          }
        },
        "control": {
          "type": "set_of_pins",
          "length": {
            "bind": {
              "type": "input",
              "id": "pin",
              "concept": {
                "length": {
                  "kind": "eq"
                }
              }
            }
          },
          "args": {
            "T": {
              "type": "spinner",
              "default": 0,
              "min": 0,
              "max": 255
            }
          },
          "implementation": [
            "the control should show a row of spinners, each spinner per pin",
            "the control should permit adding and removing pins",
            "the pin numbers should be editable",
            "the pin numbers should be unique and sorted ascending"
          ]
        }
      }
    }
  },
  "const_f32": {
    "ns": [
      "push",
      "f32",
      "sources"
    ],
    "icon": "push.const.svg",
    "title": "Constant",
    "description": "Constant value",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "conf": {
      "precision": {
        "type": {
          "raw": "u32"
        },
        "control": {
          "type": "slider",
          "default": 10,
          "min": 1,
          "max": 1000,
          "unit": "ms"
        }
      },
      "v": {
        "type": {
          "raw": "f32"
        },
        "control": {
          "type": "text_input",
          "format": "f32",
          "implementation": [
            "the control should be able to define a constant value"
          ]
        }
      }
    },
    "implementation": [
      "the implementation should propagate the constant value periodically across all streams"
    ]
  },
  "cos_gen_f32": {
    "ns": [
      "push",
      "f32",
      "sources"
    ],
    "icon": "push.cos-gen.svg",
    "title": "cos",
    "description": "Cosine generator",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "conf": {
      "precision": {
        "type": {
          "raw": "u32"
        },
        "control": {
          "type": "slider",
          "default": 10,
          "min": 1,
          "max": 1000,
          "unit": "ms"
        }
      }
    }
  },
  "sin_gen_f32": {
    "ns": [
      "push",
      "f32",
      "sources"
    ],
    "icon": "push.sin-gen.svg",
    "title": "sin",
    "description": "Sine generator",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "conf": {
      "precision": {
        "type": {
          "raw": "u32"
        },
        "control": {
          "type": "slider",
          "default": 10,
          "min": 1,
          "max": 1000,
          "unit": "ms"
        }
      }
    }
  },
  "rand_gen_f32": {
    "ns": [
      "push",
      "f32",
      "sources"
    ],
    "icon": "push.rand-gen.svg",
    "title": "Random",
    "description": "Random generator",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "conf": {
      "precision": {
        "type": {
          "raw": "u32"
        },
        "control": {
          "type": "slider",
          "default": 10,
          "min": 1,
          "max": 1000,
          "unit": "ms"
        }
      }
    }
  },
  "pulse_gen_f32": {
    "ns": [
      "push",
      "f32",
      "sources"
    ],
    "icon": "push.pulse-gen.svg",
    "title": "Pulse",
    "description": "Pulse signal generator",
    "inputs": {
      "v": {
        "vector": true,
        "type": {
          "raw": "pss",
          "args": {
            "T": {
              "raw": "f32"
            }
          }
        }
      }
    },
    "conf": {
      "period": {
        "type": {
          "raw": "u32"
        },
        "control": {
          "type": "slider",
          "default": 10,
          "min": 10,
          "max": 1000,
          "step": 10,
          "unit": "ms"
        }
      },
      "duty_cycle": {
        "type": {
          "raw": "f32"
        },
        "control": {
          "type": "slider",
          "default": 0.5,
          "min": 0,
          "max": 1,
          "step": 0.01
        }
      }
    }
  }
} as const;

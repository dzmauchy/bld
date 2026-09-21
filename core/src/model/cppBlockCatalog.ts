/**
 * @title C++ Block Catalog
 *
 * Bindings from JSON block refs to `push::f32` classes in `base.hpp`.
 */
export type CppCtorArgType = "u32" | "u16" | "f32" | "u8[]";

export type CppCtorArg = {
  readonly key: string;
  readonly type: CppCtorArgType;
  readonly fallback: number | readonly number[];
};

export type CppBlockKind = "sink" | "unary" | "aggregate" | "source" | "gpio";

export abstract class CppBlockBinding {
  abstract readonly ref: string;
  abstract readonly cppClass: string;
  abstract readonly kind: CppBlockKind;
  abstract readonly ctorArgs: readonly CppCtorArg[];
  abstract readonly inputPort: string | undefined;
  abstract readonly outputPort: string | undefined;
}

export class ScopeF32Binding extends CppBlockBinding {
  readonly ref = "scope_f32";
  readonly cppClass = "push::f32::sinks::ScopeF32";
  readonly kind = "sink" as const;
  readonly inputPort = undefined;
  readonly outputPort = "sink";
  readonly ctorArgs = [
    { key: "period", type: "u32", fallback: 60 },
    { key: "precision", type: "u32", fallback: 10 },
  ] as const;
}

export class CosF32Binding extends CppBlockBinding {
  readonly ref = "cos_f32";
  readonly cppClass = "push::f32::transformers::CosF32";
  readonly kind = "unary" as const;
  readonly inputPort = "v";
  readonly outputPort = "cos";
  readonly ctorArgs = [] as const;
}

export class SinF32Binding extends CppBlockBinding {
  readonly ref = "sin_f32";
  readonly cppClass = "push::f32::transformers::SinF32";
  readonly kind = "unary" as const;
  readonly inputPort = "v";
  readonly outputPort = "sin";
  readonly ctorArgs = [] as const;
}

export class ProductF32Binding extends CppBlockBinding {
  readonly ref = "product_f32";
  readonly cppClass = "push::f32::transformers::ProductF32";
  readonly kind = "aggregate" as const;
  readonly inputPort = "v";
  readonly outputPort = "p";
  readonly ctorArgs = [{ key: "precision", type: "u32", fallback: 10 }] as const;
}

export class SumF32Binding extends CppBlockBinding {
  readonly ref = "sum_f32";
  readonly cppClass = "push::f32::transformers::SumF32";
  readonly kind = "aggregate" as const;
  readonly inputPort = "v";
  readonly outputPort = "s";
  readonly ctorArgs = [{ key: "precision", type: "u32", fallback: 10 }] as const;
}

export class ConstF32Binding extends CppBlockBinding {
  readonly ref = "const_f32";
  readonly cppClass = "push::f32::sources::ConstF32";
  readonly kind = "source" as const;
  readonly inputPort = "v";
  readonly outputPort = undefined;
  readonly ctorArgs = [{ key: "v", type: "f32", fallback: 1 }] as const;
}

export class CosGenF32Binding extends CppBlockBinding {
  readonly ref = "cos_gen_f32";
  readonly cppClass = "push::f32::sources::CosGenF32";
  readonly kind = "source" as const;
  readonly inputPort = "v";
  readonly outputPort = undefined;
  readonly ctorArgs = [
    { key: "precision", type: "u32", fallback: 10 },
    { key: "frequency", type: "f32", fallback: 1 },
    { key: "amplitude", type: "f32", fallback: 1 },
    { key: "phase", type: "f32", fallback: 0 },
  ] as const;
}

export class SinGenF32Binding extends CppBlockBinding {
  readonly ref = "sin_gen_f32";
  readonly cppClass = "push::f32::sources::SinGenF32";
  readonly kind = "source" as const;
  readonly inputPort = "v";
  readonly outputPort = undefined;
  readonly ctorArgs = [
    { key: "precision", type: "u32", fallback: 10 },
    { key: "frequency", type: "f32", fallback: 1 },
    { key: "amplitude", type: "f32", fallback: 1 },
    { key: "phase", type: "f32", fallback: 0 },
  ] as const;
}

export class RandGenF32Binding extends CppBlockBinding {
  readonly ref = "rand_gen_f32";
  readonly cppClass = "push::f32::sources::RandGenF32";
  readonly kind = "source" as const;
  readonly inputPort = "v";
  readonly outputPort = undefined;
  readonly ctorArgs = [
    { key: "precision", type: "u32", fallback: 10 },
    { key: "amplitude", type: "f32", fallback: 1 },
  ] as const;
}

export class PulseGenF32Binding extends CppBlockBinding {
  readonly ref = "pulse_gen_f32";
  readonly cppClass = "push::f32::sources::PulseGenF32";
  readonly kind = "source" as const;
  readonly inputPort = "v";
  readonly outputPort = undefined;
  readonly ctorArgs = [
    { key: "duty_cycle", type: "f32", fallback: 0.5 },
    { key: "amplitude", type: "f32", fallback: 1 },
    { key: "frequency", type: "f32", fallback: 1 },
    { key: "phase", type: "f32", fallback: 0 },
  ] as const;
}

export class GpioInF32Binding extends CppBlockBinding {
  readonly ref = "gpio_in_f32";
  readonly cppClass = "push::f32::sources::GpioInF32";
  readonly kind = "gpio" as const;
  readonly inputPort = "pin";
  readonly outputPort = undefined;
  readonly ctorArgs = [
    { key: "port", type: "u16", fallback: 0 },
    { key: "pins", type: "u8[]", fallback: [0] },
  ] as const;
}

export class CppBlockCatalog {
  private static readonly sharedInstance = new CppBlockCatalog();
  static get shared(): CppBlockCatalog {
    return CppBlockCatalog.sharedInstance;
  }

  private readonly byRef = new Map<string, CppBlockBinding>();

  constructor(bindings: readonly CppBlockBinding[] = CppBlockCatalog.defaultBindings()) {
    for (const binding of bindings) this.byRef.set(binding.ref, binding);
  }

  static defaultBindings(): CppBlockBinding[] {
    return [
      new ScopeF32Binding(),
      new CosF32Binding(),
      new SinF32Binding(),
      new ProductF32Binding(),
      new SumF32Binding(),
      new ConstF32Binding(),
      new CosGenF32Binding(),
      new SinGenF32Binding(),
      new RandGenF32Binding(),
      new PulseGenF32Binding(),
      new GpioInF32Binding(),
    ];
  }

  get(ref: string): CppBlockBinding | undefined {
    return this.byRef.get(ref);
  }

  require(ref: string): CppBlockBinding {
    const binding = this.byRef.get(ref);
    if (!binding) throw new Error(`Unknown C++ block "${ref}"`);
    return binding;
  }

  refs(): string[] {
    return this.byRef.keys().toArray();
  }

  has(ref: string): boolean {
    return this.byRef.has(ref);
  }
}

export const defaultCppBlockCatalog = CppBlockCatalog.shared;

import "react";

declare module "react" {
  interface MathMLAttributes
    extends AriaAttributes,
      DOMAttributes<MathMLElement> {
    className?: string;
    columnalign?: string;
    display?: "block" | "inline";
    mathvariant?: string;
    rowspacing?: string;
    stretchy?: "true" | "false";
    width?: string;
  }

  namespace JSX {
    interface IntrinsicElements {
      math: MathMLAttributes;
      mfrac: MathMLAttributes;
      mi: MathMLAttributes;
      mn: MathMLAttributes;
      mo: MathMLAttributes;
      mrow: MathMLAttributes;
      mspace: MathMLAttributes;
      msub: MathMLAttributes;
      msubsup: MathMLAttributes;
      msup: MathMLAttributes;
      mtable: MathMLAttributes;
      mtd: MathMLAttributes;
      mtext: MathMLAttributes;
      mtr: MathMLAttributes;
      munder: MathMLAttributes;
      munderover: MathMLAttributes;
    }
  }
}

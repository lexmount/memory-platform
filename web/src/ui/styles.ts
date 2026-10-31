import tokens from "./tokens.css?inline";
import primitives from "./ui.css?inline";

// Selectors are scoped in the CSS source so production minification cannot
// change whether the developer surface receives its own reset and palette.
export const componentStyles = [tokens, primitives].join("\n");

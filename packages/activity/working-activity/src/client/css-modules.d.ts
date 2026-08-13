/* CSS Modules ambient declaration for the client half (tsc only; the tsdown
   bundle inlines compiled class maps). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

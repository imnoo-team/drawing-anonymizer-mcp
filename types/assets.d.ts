// esbuild `binary` loader: the imported asset is the file's bytes.
declare module '*.ttf' {
  const bytes: Uint8Array;
  export default bytes;
}

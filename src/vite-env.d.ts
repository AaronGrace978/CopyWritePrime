/// <reference types="vite/client" />

declare module "mammoth" {
  const mammoth: {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  export default mammoth;
}

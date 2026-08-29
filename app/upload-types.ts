export const imageUploadTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

export const orderDocumentTypes = [
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  ...imageUploadTypes,
] as const;

export const receiptDocumentTypes = ["application/pdf", ...imageUploadTypes] as const;

export function isSupportedOrderDocument(type: string) {
  return (orderDocumentTypes as readonly string[]).includes(type);
}

export function isSupportedReceiptDocument(type: string) {
  return (receiptDocumentTypes as readonly string[]).includes(type);
}

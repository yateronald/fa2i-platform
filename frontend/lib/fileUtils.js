/**
 * Read a File object as a base64 data URL, returning the dataUrl, mimeType, and size.
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, mimeType: string, size: number }>}
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, mimeType: file.type, size: file.size });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

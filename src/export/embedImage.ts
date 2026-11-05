/** Only called after the existing per-file asset authorization succeeds. */
export async function embedImage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image failed to load: ${url}`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`Unsupported image: ${url}`);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Image failed to read: ${url}`));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid image data"));
    reader.readAsDataURL(blob);
  });
}

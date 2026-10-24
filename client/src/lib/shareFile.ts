// Download or hand a generated PDF to the phone's share sheet (Messages, Mail,
// AirDrop…). Web Share with files needs a secure context (https or localhost),
// so over plain-http dev hosts only Download is offered.

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareFiles() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

export async function shareFile(blob: Blob, fileName: string, title: string) {
  const file = new File([blob], fileName, { type: "application/pdf" });
  await navigator.share({ files: [file], title });
}

// Pulls the filename out of a Content-Disposition header.
export function filenameFromResponse(res: Response, fallback: string) {
  const dispo = res.headers.get("Content-Disposition") ?? "";
  return dispo.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

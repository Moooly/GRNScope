const DEFAULT_MAX_LENGTH = 44;

export function formatFileNameForDisplay(
  fileName: string,
  maxLength = DEFAULT_MAX_LENGTH,
) {
  if (fileName.length <= maxLength) return fileName;

  const extensionStart = fileName.lastIndexOf(".");
  const hasShortExtension =
    extensionStart > 0 && fileName.length - extensionStart <= 10;
  const extension = hasShortExtension ? fileName.slice(extensionStart) : "";
  const stem = hasShortExtension ? fileName.slice(0, extensionStart) : fileName;
  const availableStemLength = Math.max(12, maxLength - extension.length - 3);
  const startLength = Math.ceil(availableStemLength * 0.55);
  const endLength = Math.floor(availableStemLength * 0.45);

  return `${stem.slice(0, startLength)}...${stem.slice(-endLength)}${extension}`;
}

interface FileNameDisplayProps {
  fileName: string;
  placeholder: string;
  maxLength?: number;
  className?: string;
}

export default function FileNameDisplay({
  fileName,
  placeholder,
  maxLength = DEFAULT_MAX_LENGTH,
  className = "",
}: FileNameDisplayProps) {
  const hasFile = fileName.length > 0;
  const displayText = hasFile
    ? formatFileNameForDisplay(fileName, maxLength)
    : placeholder;

  return (
    <span
      className={`block w-full max-w-full overflow-hidden px-2 text-center text-sm font-semibold leading-5 text-slate-950 ${className}`}
      title={hasFile ? fileName : undefined}
    >
      <span className="inline-block max-w-full break-words align-middle">
        {displayText}
      </span>
    </span>
  );
}

import { useRef, useState } from "react";
import { usePhotos, useUploadPhoto, useDeletePhoto } from "../api/photos";
import { localDateString, formatDayLabel } from "../lib/date";

export default function PhotosScreen() {
  const photos = usePhotos();
  const upload = useUploadPhoto();
  const deletePhoto = useDeletePhoto();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    upload.mutate({ file, date: localDateString() });
  }

  const viewing = photos.data?.find((p) => p.id === viewingId);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-medium">Photos</h1>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="text-xs px-3 py-1.5 rounded-md bg-accent font-medium disabled:opacity-40"
          style={{ color: "#0B1210" }}
        >
          {upload.isPending ? "Uploading…" : "+ Add photo"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </header>

      <main className="px-4 max-w-md mx-auto">
        {photos.data?.length === 0 && (
          <p className="text-sm text-muted text-center py-10">
            No progress photos yet — tap "Add photo" to take or upload one.
          </p>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {photos.data?.map((photo) => (
            <button
              key={photo.id}
              onClick={() => setViewingId(photo.id)}
              className="relative aspect-square rounded-md overflow-hidden bg-surface"
            >
              <img
                src={`/api/photos/${photo.id}/file`}
                alt={formatDayLabel(photo.date)}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      </main>

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 shrink-0">
            <span className="text-sm text-ink">{formatDayLabel(viewing.date)}</span>
            <button onClick={() => setViewingId(null)} className="text-muted text-xl leading-none px-1">
              ×
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <img
              src={`/api/photos/${viewing.id}/file`}
              alt={formatDayLabel(viewing.date)}
              className="max-w-full max-h-full object-contain"
            />
          </div>
          <div className="p-4 shrink-0">
            <button
              onClick={() => {
                deletePhoto.mutate(viewing.id);
                setViewingId(null);
              }}
              className="w-full py-3 rounded-md border border-line text-sm text-muted"
            >
              Delete photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { Camera, Image } from "lucide-react";
import BottomSheet from "./BottomSheet";

// Two options, always asked, rather than leaving it to the browser's own
// bare accept="image/*" chooser — that doesn't reliably show a "Camera or
// Gallery?" prompt on Android/Chrome, it can jump straight into one or the
// other instead. Pairs with two separate hidden file inputs at the call
// site (one with capture="environment" for camera, one without for
// library/gallery) — see PhotosScreen.tsx's cameraInputRef/libraryInputRef
// comment, the original use of this pattern.
export default function PhotoSourceSheet({
  onChooseCamera,
  onChooseLibrary,
  onClose,
}: {
  onChooseCamera: () => void;
  onChooseLibrary: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/60"
      panelClassName="bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium text-ink">Add photo</span>
          </div>
          <div className="px-4 pb-4 space-y-2">
            <button
              onClick={() => {
                onChooseCamera();
                close();
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-md bg-dashboardCard text-left active:bg-surface-raised"
            >
              <Camera size={18} strokeWidth={2} className="text-muted" />
              <span className="text-sm text-ink flex-1">Take Photo</span>
            </button>
            <button
              onClick={() => {
                onChooseLibrary();
                close();
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-md bg-dashboardCard text-left active:bg-surface-raised"
            >
              <Image size={18} strokeWidth={2} className="text-muted" />
              <span className="text-sm text-ink flex-1">Choose from Library</span>
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

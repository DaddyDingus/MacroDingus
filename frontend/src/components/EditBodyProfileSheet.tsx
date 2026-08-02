import BottomSheet from "./BottomSheet";
import BasicProfileForm from "./BasicProfileForm";
import { useSaveProfile, type Profile } from "../api/coach";

export default function EditBodyProfileSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const saveProfile = useSaveProfile();

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[90%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Body &amp; Lifestyle</h2>
            <p className="text-xs text-muted mt-1">Feeds your expenditure estimate</p>
          </div>
          <div className="p-4 overflow-y-auto">
            <BasicProfileForm
              saving={saveProfile.isPending}
              ctaLabel="Save"
              initial={{
                sex: profile.sex,
                birthYear: profile.birthYear,
                heightCm: profile.heightCm,
                activityLevel: profile.activityLevel,
                weeklyExerciseHours: profile.weeklyExerciseHours,
                checkInDayOfWeek: profile.checkInDayOfWeek,
              }}
              onSave={(input) => saveProfile.mutate(input, { onSuccess: close })}
            />
          </div>
        </>
      )}
    </BottomSheet>
  );
}

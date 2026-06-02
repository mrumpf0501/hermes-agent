import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Clock, Pause, Pencil, Play, Trash2, X, Zap } from "lucide-react";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { H2 } from "@nous-research/ui/ui/components/typography/h2";
import { api } from "@/lib/api";
import type { CronJob, ProfileInfo } from "@/lib/api";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { useConfirmDelete } from "@nous-research/ui/hooks/use-confirm-delete";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { Card, CardContent } from "@nous-research/ui/ui/components/card";
import { Input } from "@nous-research/ui/ui/components/input";
import { Label } from "@nous-research/ui/ui/components/label";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { PluginSlot } from "@/plugins";
import { cn, themedBody } from "@/lib/utils";

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? value.slice(0, maxLength) + "..."
    : value;
}

function getJobPrompt(job: CronJob): string {
  return asText(job.prompt);
}

function getJobName(job: CronJob): string {
  return asText(job.name).trim();
}

function getJobTitle(job: CronJob): string {
  const name = getJobName(job);
  if (name) return name;

  const prompt = getJobPrompt(job);
  if (prompt) return truncateText(prompt, 60);

  const script = asText(job.script);
  if (script) return truncateText(script, 60);

  return job.id || "Cron job";
}

function getJobScheduleDisplay(job: CronJob): string {
  return (
    asText(job.schedule_display) ||
    asText(job.schedule?.display) ||
    asText(job.schedule?.expr) ||
    "—"
  );
}

/** Value for the schedule input when creating or editing a job. */
function getScheduleInput(job?: CronJob | null): string {
  if (!job) return "";
  const expr = asText(job.schedule?.expr);
  if (expr) return expr;
  const display = asText(job.schedule?.display);
  if (display) return display;
  const shown = asText(job.schedule_display);
  return shown === "—" ? "" : shown;
}

function getJobState(job: CronJob): string {
  return asText(job.state) || (job.enabled === false ? "disabled" : "scheduled");
}

function getJobProfile(job: CronJob): string {
  return asText(job.profile) || asText(job.profile_name) || "default";
}

function getJobKey(job: CronJob): string {
  return `${getJobProfile(job)}:${job.id}`;
}

function splitJobKey(key: string): { profile: string; id: string } {
  const idx = key.indexOf(":");
  if (idx === -1) return { profile: "default", id: key };
  return { profile: key.slice(0, idx) || "default", id: key.slice(idx + 1) };
}

function profileLabel(profile: string): string {
  return profile === "default" ? "default" : profile;
}

const STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = {
  enabled: "success",
  scheduled: "success",
  paused: "warning",
  error: "destructive",
  completed: "destructive",
};

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("all");
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();
  const { t } = useI18n();
  const { setEnd } = usePageHeader();

  type CronModalMode = "create" | "edit";
  const [modalMode, setModalMode] = useState<CronModalMode | null>(null);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("");
  const [name, setName] = useState("");
  const [deliver, setDeliver] = useState("local");
  const [saving, setSaving] = useState(false);

  const closeJobModal = useCallback(() => {
    setModalMode(null);
    setEditingJob(null);
  }, []);
  const jobModalRef = useModalBehavior({
    open: modalMode !== null,
    onClose: closeJobModal,
  });

  const createProfile = selectedProfile === "all" ? "default" : selectedProfile;
  const isEditing = modalMode === "edit" && editingJob !== null;

  const resetForm = useCallback(() => {
    setPrompt("");
    setSchedule("");
    setName("");
    setDeliver("local");
    setEditingJob(null);
  }, []);

  const openCreateModal = useCallback(() => {
    resetForm();
    setModalMode("create");
  }, [resetForm]);

  const openEditModal = useCallback((job: CronJob) => {
    setEditingJob(job);
    setName(getJobName(job));
    setPrompt(getJobPrompt(job));
    setSchedule(getScheduleInput(job));
    setDeliver(asText(job.deliver) || "local");
    setModalMode("edit");
  }, []);

  const loadJobs = useCallback(() => {
    api
      .getCronJobs(selectedProfile)
      .then(setJobs)
      .catch(() => showToast(t.common.loading, "error"))
      .finally(() => setLoading(false));
  }, [selectedProfile, showToast, t.common.loading]);

  useEffect(() => {
    api
      .getProfiles()
      .then((res) => setProfiles(res.profiles))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleSaveJob = async () => {
    if (!prompt.trim() || !schedule.trim()) {
      showToast(`${t.cron.prompt} & ${t.cron.schedule} required`, "error");
      return;
    }
    setSaving(true);
    try {
      if (isEditing && editingJob) {
        const profile = getJobProfile(editingJob);
        await api.updateCronJob(
          editingJob.id,
          {
            prompt: prompt.trim(),
            schedule: schedule.trim(),
            name: name.trim(),
            deliver,
          },
          profile,
        );
        showToast(`${t.common.save} ✓`, "success");
      } else {
        await api.createCronJob(
          {
            prompt: prompt.trim(),
            schedule: schedule.trim(),
            name: name.trim() || undefined,
            deliver,
          },
          createProfile,
        );
        showToast(t.common.create + " ✓", "success");
      }
      resetForm();
      setModalMode(null);
      loadJobs();
    } catch (e) {
      showToast(`${t.config.failedToSave}: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handlePauseResume = async (job: CronJob) => {
    try {
      const isPaused = getJobState(job) === "paused";
      const profile = getJobProfile(job);
      if (isPaused) {
        await api.resumeCronJob(job.id, profile);
        showToast(
          `${t.cron.resume}: "${truncateText(getJobTitle(job), 30)}"`,
          "success",
        );
      } else {
        await api.pauseCronJob(job.id, profile);
        showToast(
          `${t.cron.pause}: "${truncateText(getJobTitle(job), 30)}"`,
          "success",
        );
      }
      loadJobs();
    } catch (e) {
      showToast(`${t.status.error}: ${e}`, "error");
    }
  };

  const handleTrigger = async (job: CronJob) => {
    try {
      await api.triggerCronJob(job.id, getJobProfile(job));
      showToast(
        `${t.cron.triggerNow}: "${truncateText(getJobTitle(job), 30)}"`,
        "success",
      );
      loadJobs();
    } catch (e) {
      showToast(`${t.status.error}: ${e}`, "error");
    }
  };

  const jobDelete = useConfirmDelete({
    onDelete: useCallback(
      async (key: string) => {
        const { profile, id } = splitJobKey(key);
        const job = jobs.find((j) => getJobKey(j) === key);
        try {
          await api.deleteCronJob(id, profile);
          showToast(
            `${t.common.delete}: "${job ? truncateText(getJobTitle(job), 30) : id}"`,
            "success",
          );
          loadJobs();
        } catch (e) {
          showToast(`${t.status.error}: ${e}`, "error");
          throw e;
        }
      },
      [jobs, loadJobs, showToast, t.common.delete, t.status.error],
    ),
  });

  // Put "Create" button in page header
  useLayoutEffect(() => {
    setEnd(
      <Button
        className="uppercase"
        size="sm"
        onClick={openCreateModal}
      >
        {t.common.create}
      </Button>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd, t.common.create, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="text-2xl text-primary" />
      </div>
    );
  }

  const pendingJob = jobDelete.pendingId
    ? jobs.find((j) => getJobKey(j) === jobDelete.pendingId)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PluginSlot name="cron:top" />
      <Toast toast={toast} />

      <DeleteConfirmDialog
        open={jobDelete.isOpen}
        onCancel={jobDelete.cancel}
        onConfirm={jobDelete.confirm}
        title={t.cron.confirmDeleteTitle}
        description={
          pendingJob
            ? `"${truncateText(getJobTitle(pendingJob), 40)}" — ${
                t.cron.confirmDeleteMessage
              }`
            : t.cron.confirmDeleteMessage
        }
        loading={jobDelete.isDeleting}
      />

      {/* Create / edit job modal */}
      {modalMode !== null && (
        <div
          ref={jobModalRef}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && closeJobModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cron-job-modal-title"
        >
          <div className={cn(themedBody, "relative w-full max-w-lg border border-border bg-card shadow-2xl flex flex-col")}>
            <Button
              ghost
              size="icon"
              onClick={closeJobModal}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              aria-label={t.common.close}
            >
              <X />
            </Button>

            <header className="p-5 pb-3 border-b border-border">
              <h2
                id="cron-job-modal-title"
                className="font-mondwest text-display text-base tracking-wider"
              >
                {isEditing ? t.cron.editJob : t.cron.newJob}
              </h2>
            </header>

            <div className="p-5 grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="cron-profile">Profile</Label>
                {isEditing && editingJob ? (
                  <p
                    id="cron-profile"
                    className="text-sm font-mono text-muted-foreground border border-border bg-background/40 px-3 py-2"
                  >
                    {profileLabel(getJobProfile(editingJob))}
                  </p>
                ) : (
                  <Select
                    id="cron-profile"
                    value={createProfile}
                    onValueChange={(v) => setSelectedProfile(v)}
                  >
                    {profiles.map((profile) => (
                      <SelectOption key={profile.name} value={profile.name}>
                        {profileLabel(profile.name)}
                      </SelectOption>
                    ))}
                  </Select>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cron-name">{t.cron.nameOptional}</Label>
                <Input
                  id="cron-name"
                  autoFocus
                  placeholder={t.cron.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cron-prompt">{t.cron.prompt}</Label>
                <textarea
                  id="cron-prompt"
                  className="flex min-h-[80px] w-full border border-border bg-background/40 px-3 py-2 text-sm font-courier shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 focus-visible:border-foreground/25"
                  placeholder={t.cron.promptPlaceholder}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="cron-schedule">{t.cron.schedule}</Label>
                  <Input
                    id="cron-schedule"
                    placeholder={t.cron.schedulePlaceholder}
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="cron-deliver">{t.cron.deliverTo}</Label>
                  <Select
                    id="cron-deliver"
                    value={deliver}
                    onValueChange={(v) => setDeliver(v)}
                  >
                    <SelectOption value="local">
                      {t.cron.delivery.local}
                    </SelectOption>
                    <SelectOption value="telegram">
                      {t.cron.delivery.telegram}
                    </SelectOption>
                    <SelectOption value="discord">
                      {t.cron.delivery.discord}
                    </SelectOption>
                    <SelectOption value="slack">
                      {t.cron.delivery.slack}
                    </SelectOption>
                    <SelectOption value="email">
                      {t.cron.delivery.email}
                    </SelectOption>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  ghost
                  className="uppercase"
                  size="sm"
                  onClick={closeJobModal}
                  disabled={saving}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  className="uppercase"
                  size="sm"
                  onClick={handleSaveJob}
                  disabled={saving}
                  prefix={saving ? <Spinner /> : undefined}
                >
                  {saving
                    ? t.common.saving
                    : isEditing
                      ? t.common.save
                      : t.common.create}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <H2
            variant="sm"
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Clock className="h-4 w-4" />
            {t.cron.scheduledJobs} ({jobs.length})
          </H2>

          <div className="grid gap-1 min-w-[220px]">
            <Label htmlFor="cron-profile-filter">Profile</Label>
            <Select
              id="cron-profile-filter"
              value={selectedProfile}
              onValueChange={(v) => setSelectedProfile(v)}
            >
              <SelectOption value="all">All profiles</SelectOption>
              {profiles.map((profile) => (
                <SelectOption key={profile.name} value={profile.name}>
                  {profileLabel(profile.name)}
                </SelectOption>
              ))}
            </Select>
          </div>
        </div>

        {jobs.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t.cron.noJobs}
            </CardContent>
          </Card>
        )}

        {jobs.map((job) => {
          const state = getJobState(job);
          const promptText = getJobPrompt(job);
          const title = getJobTitle(job);
          const hasName = Boolean(getJobName(job));
          const deliver = asText(job.deliver);
          const profile = getJobProfile(job);
          const jobKey = getJobKey(job);

          return (
            <Card key={jobKey}>
              <CardContent className="flex items-start gap-4 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">
                      {title}
                    </span>
                    <Badge tone={STATUS_TONE[state] ?? "secondary"}>
                      {state}
                    </Badge>
                    <Badge tone="outline">{profileLabel(profile)}</Badge>
                    {deliver && deliver !== "local" && (
                      <Badge tone="outline">{deliver}</Badge>
                    )}
                  </div>
                  {hasName && promptText && (
                    <p className="text-xs text-muted-foreground truncate mb-1">
                      {truncateText(promptText, 100)}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="font-mono">{getJobScheduleDisplay(job)}</span>
                    <span>
                      {t.cron.last}: {formatTime(job.last_run_at)}
                    </span>
                    <span>
                      {t.cron.next}: {formatTime(job.next_run_at)}
                    </span>
                  </div>
                  {job.last_error && (
                    <p className="text-xs text-destructive mt-1">
                      {job.last_error}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    ghost
                    size="icon"
                    title={t.cron.editJob}
                    aria-label={t.cron.editJob}
                    onClick={() => openEditModal(job)}
                  >
                    <Pencil />
                  </Button>

                  <Button
                    ghost
                    size="icon"
                    title={state === "paused" ? t.cron.resume : t.cron.pause}
                    aria-label={
                      state === "paused" ? t.cron.resume : t.cron.pause
                    }
                    onClick={() => handlePauseResume(job)}
                    className={
                      state === "paused" ? "text-success" : "text-warning"
                    }
                  >
                    {state === "paused" ? <Play /> : <Pause />}
                  </Button>

                  <Button
                    ghost
                    size="icon"
                    title={t.cron.triggerNow}
                    aria-label={t.cron.triggerNow}
                    onClick={() => handleTrigger(job)}
                  >
                    <Zap />
                  </Button>

                  <Button
                    ghost
                    destructive
                    size="icon"
                    title={t.common.delete}
                    aria-label={t.common.delete}
                    onClick={() => jobDelete.requestDelete(jobKey)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <PluginSlot name="cron:bottom" />
    </div>
  );
}

export const TOPIC_LABELS: Record<string, string> = {
  politics: "Politics", economy: "Economy", society: "Society", crime: "Crime & justice", health: "Health",
  science: "Science", technology: "Technology", environment: "Environment", culture: "Culture", sports: "Sports",
  mobility: "Mobility", weather: "Weather", other: "Other",
};

export const topicLabel = (topic: string) => TOPIC_LABELS[topic] ?? topic;

/** Lucide icons for the picture placeholder. Listed in nuxt.config.ts so they are bundled. */
export const TOPIC_ICONS: Record<string, string> = {
  politics: "i-lucide-landmark", economy: "i-lucide-trending-up", society: "i-lucide-users", crime: "i-lucide-scale",
  health: "i-lucide-heart-pulse", science: "i-lucide-flask-conical", technology: "i-lucide-cpu", environment: "i-lucide-leaf",
  culture: "i-lucide-palette", sports: "i-lucide-trophy", mobility: "i-lucide-train-front", weather: "i-lucide-cloud-sun",
  other: "i-lucide-newspaper",
};

export const topicIcon = (topic?: string) => (topic && TOPIC_ICONS[topic]) || TOPIC_ICONS.other!;

export function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const fullDate = (iso: string) => new Date(iso).toLocaleString("en-GB");

/** The sections' fixed ids (src/settings.ts REGIONS); their labels come from the admin settings. */
export const REGION_IDS: readonly string[] = ["local", "national", "europe", "world"];

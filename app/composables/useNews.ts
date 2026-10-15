// The published snapshot from /api/public/news.json (see src/rank.ts), loaded once and shared
// by every page, so moving between sections and stories never waits on the network.

export interface Story {
  id: number;
  headline: string;
  summary: string;
  lang: string | null;
  region: string;
  topic: string;
  priority: "high" | "medium" | "low";
  breaking: boolean;
  publishedAt: string;
  updatedAt: string;
  image: string | null;
  sources: { name: string; url: string }[];
}

export interface NewsData {
  generatedAt: string | null;
  nextUpdateAt?: string;
  site: { title: string; tagline: string; regions: { id: string; label: string }[] };
  stories: Story[];
}

const DEFAULT_TITLE = "Atlesque News";

export function useNews() {
  const data = useState<NewsData | null>("news", () => null);
  const error = useState<boolean>("news-error", () => false);

  const title = computed(() => data.value?.site.title || DEFAULT_TITLE);
  const regions = computed(() => data.value?.site.regions ?? []);
  const regionLabel = (id: string) => regions.value.find((r) => r.id === id)?.label ?? id;

  async function load() {
    try {
      const res = await fetch("/api/public/news.json", { credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Before the first refresh the endpoint has no site settings yet.
      data.value = json.site ? json : { ...json, site: { title: DEFAULT_TITLE, tagline: "", regions: [] }, stories: [] };
      error.value = false;
    } catch (err) {
      if (!data.value) error.value = true;
      console.error(err);
    }
  }

  return { data, error, title, regions, regionLabel, load };
}

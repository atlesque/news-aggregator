// The topic chips' selection. It belongs to one list page: it survives a trip to a story and
// back, and clears when the reader opens another section or presses the logo.
export function useTopicFilter() {
  const topic = useState("topic", () => "");
  const topicFor = useState("topic-for", () => "");

  /** Call when a list page opens; keeps the topic only if it was picked on this same page. */
  function enter(path: string) {
    if (topicFor.value !== path) topic.value = "";
    topicFor.value = path;
  }

  function reset() {
    topic.value = "";
  }

  return { topic, enter, reset };
}

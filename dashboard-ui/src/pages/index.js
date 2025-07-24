import { useEffect, useState } from "react";
import axios from "axios";

const OLLAMA_API = process.env.NEXT_PUBLIC_OLLAMA_API || "http://136.243.78.14:11434/api";
const NEXTCLOUD_URL = process.env.NEXT_PUBLIC_NEXTCLOUD_URL || "https://dashboard.kingdom-hosting.de/nextcloud";

export default function Dashboard() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${OLLAMA_API}/tags`)
      .then(res => setModels(res.data.models.map(m => m.name)));
  }, []);

  async function handlePrompt(e) {
    e.preventDefault();
    setLoading(true);
    const res = await axios.post(`${OLLAMA_API}/chat`, {
      model,
      messages: [{ role: "user", content: prompt }]
    });
    setOutput(res.data.message.content);
    setLoading(false);
  }

  return (
    <div className="max-w-xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">GPT Dashboard</h1>
      <form className="mb-4 flex flex-row gap-2" onSubmit={handlePrompt}>
        <select className="border px-2 py-1" value={model} onChange={e => setModel(e.target.value)} required>
          <option value="">Modell wählen</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className="border flex-1 px-2 py-1" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Prompt eingeben" required />
        <button className="bg-blue-600 text-white px-3 py-1 rounded" disabled={loading}>Senden</button>
      </form>
      <div className="bg-gray-100 p-4 rounded min-h-[120px]">
        {output || "Antwort erscheint hier..."}
      </div>
      <a href={NEXTCLOUD_URL} className="mt-4 inline-block text-blue-700 underline">Zu Nextcloud (Dateien & Medien)</a>
    </div>
  );
}

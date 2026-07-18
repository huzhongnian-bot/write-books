"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UploadForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError("请输入项目名称");
      return;
    }
    if (!file) {
      setError("请选择 TXT 文件");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("file", file);

      const res = await fetch("/api/works", {
        method: "POST",
        body: formData,
      });
      const data: { projectId?: number; error?: string } = await res.json();

      if (!res.ok || data.projectId === undefined) {
        setError(data.error ?? "上传失败，请重试");
        return;
      }

      router.push(`/projects/${data.projectId}`);
    } catch {
      setError("网络错误，上传失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="project-name">项目名称</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：西游记二创"
          disabled={submitting}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="work-file">原作 TXT 文件</Label>
        <Input
          id="work-file"
          type="file"
          accept=".txt,text/plain"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={submitting}
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? "上传中…" : "上传并开始摄取"}
      </Button>
    </form>
  );
}

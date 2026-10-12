import { ViralWorkspace } from "@/components/viral/viral-workspace";

export const metadata = { title: "爆款复创草稿 · DO-Vedio" };
export default async function ViralDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ViralWorkspace key={id} draftId={id} />;
}

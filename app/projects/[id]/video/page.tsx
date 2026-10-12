import { VideoStudio } from "@/components/video-studio";
import Link from "next/link";
import { sourceByProject } from "@/lib/server/viral/repository";

export const dynamic = "force-dynamic";

export default async function VideoPage(props: PageProps<"/projects/[id]/video">) {
  const { id } = await props.params;
  const source = sourceByProject(id);
  return <>
    {source && <div className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm text-text-secondary">
      <span>文案来自爆款复创 · 后续修改需在复创页明确同步</span>
      <Link className="btn btn-ghost btn-sm" href={`/viral/${source.draftId}`}>返回来源草稿</Link>
    </div>}
    <VideoStudio id={id} />
  </>;
}

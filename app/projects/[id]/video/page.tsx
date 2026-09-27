import { VideoStudio } from "@/components/video-studio";

export default async function VideoPage(props: PageProps<"/projects/[id]/video">) {
  const { id } = await props.params;
  return <VideoStudio id={id} />;
}

import { Workbench } from "@/components/workbench";

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  return <Workbench id={id} />;
}

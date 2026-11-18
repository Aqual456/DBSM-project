import { redirect } from "next/navigation";
import Management from "@/components/Management";

export default async function Page({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (module === "incidents") redirect("/incidents");
  if (module === "analytics") redirect("/analytics");
  return <Management module={module} />;
}

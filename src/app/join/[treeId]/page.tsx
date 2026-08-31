import { Page } from "@/components/vault/ui";
import { JoinPanel } from "@/components/vault/JoinPanel";

export const metadata = { title: "Join a tree · Kinfold" };

export default async function JoinPage({
  params,
}: {
  params: Promise<{ treeId: string }>;
}) {
  const { treeId } = await params;
  return (
    <Page title="Join a tree" back={{ href: "/", label: "Home" }}>
      <JoinPanel treeId={treeId} />
    </Page>
  );
}

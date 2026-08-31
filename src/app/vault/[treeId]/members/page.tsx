import { MembersPanel } from "@/components/vault/MembersPanel";

export const metadata = { title: "Members · Kinfold" };

export default async function VaultMembersPage({
  params,
}: {
  params: Promise<{ treeId: string }>;
}) {
  const { treeId } = await params;
  return <MembersPanel treeId={treeId} />;
}

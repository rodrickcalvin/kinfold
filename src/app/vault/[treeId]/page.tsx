import { VaultTreeView } from "@/components/vault/VaultTreeView";

export const metadata = { title: "Tree · Kinfold" };

export default async function VaultTreePage({
  params,
}: {
  params: Promise<{ treeId: string }>;
}) {
  const { treeId } = await params;
  return <VaultTreeView treeId={treeId} />;
}

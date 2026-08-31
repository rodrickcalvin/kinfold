import { TreeEditor } from "@/components/vault/TreeEditor";

export const metadata = { title: "Edit tree · Kinfold" };

export default async function EditVaultTreePage({
  params,
}: {
  params: Promise<{ treeId: string }>;
}) {
  const { treeId } = await params;
  return <TreeEditor treeId={treeId} />;
}

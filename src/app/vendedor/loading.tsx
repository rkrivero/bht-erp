import { SkeletonCards } from "@/components/ui/Skeleton";

export default function VendedorLoading() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl min-h-screen bg-bht-paper px-4 py-6 space-y-4"
    >
      <SkeletonCards count={4} />
    </main>
  );
}

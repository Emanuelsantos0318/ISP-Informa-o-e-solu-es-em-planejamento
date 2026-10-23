import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { recordMovementBatch, type MovementBatchInput } from "./movements";

export function useMovementBatch() {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MovementBatchInput) => {
      if (!client)
        throw new Error("A conexão com o Supabase não está configurada.");
      return recordMovementBatch(client, input);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["movements"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
}

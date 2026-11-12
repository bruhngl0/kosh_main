import { createSubscriber, listSubscribers } from "@/modules/subscribers";
import { created, ok, parseBody, parseQuery, route } from "@/server/http";
import { createSubscriberSchema, subscriberQuerySchema } from "@/shared/schemas/subscribers";

export const GET = route(async ({ url }) => ok(await listSubscribers(parseQuery(url, subscriberQuerySchema))));

export const POST = route(async ({ request, getActor, requestId }) => {
  const input = await parseBody(request, createSubscriberSchema);
  return created(await createSubscriber(input, { actor: await getActor(), requestId }));
});

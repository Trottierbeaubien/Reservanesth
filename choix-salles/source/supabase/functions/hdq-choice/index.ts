import {createHandler} from './runtime.ts';
Deno.serve(createHandler({supabaseUrl:Deno.env.get('SUPABASE_URL')!,serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,brevoKey:Deno.env.get('BREVO_API_KEY'),senderEmail:Deno.env.get('HDQ_SENDER_EMAIL'),senderName:Deno.env.get('HDQ_SENDER_NAME')}));

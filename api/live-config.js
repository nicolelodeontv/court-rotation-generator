module.exports=(req,res)=>{
// Vercel env names: CRG_SUPABASE_URL, CRG_SUPABASE_PUBLISHABLE_KEY
const url=process.env.CRG_SUPABASE_URL||'';const publishableKey=process.env.CRG_SUPABASE_PUBLISHABLE_KEY||'';res.setHeader('Cache-Control','no-store, max-age=0');res.status(200).json({configured:Boolean(url&&publishableKey),url,publishableKey,source:'vercel-env'});
};
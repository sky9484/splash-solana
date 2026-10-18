import SplashLoading from '@/components/SplashLoading';

/* The route-level loading state is the one loader (prompt 12 §3.2; Sky, 19 Oct: "Both use the new
   loader"): the white card on the page's ground. A route loading knows none of the desk's steps, so it
   says one thing, "Opening your desk", and shows only after 300 ms. */
export default function Loading() {
  return <SplashLoading />;
}

import type { GetServerSideProps } from "next";

export default function Domains() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: "/settings/general",
    permanent: false,
  },
});

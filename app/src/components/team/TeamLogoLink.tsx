import { Link } from "react-router-dom";

interface TeamLogoLinkProps {
  to: string;
  logo: string;
  alt: string;
  imgClassName: string;
  title: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function TeamLogoLink({ to, logo, alt, imgClassName, title, onClick }: TeamLogoLinkProps) {
  return (
    <Link
      to={to}
      title={title}
      onClick={onClick}
      className="inline-block rounded-sm transition-opacity duration-150 hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002f6c]/40"
    >
      <img src={logo} alt={alt} className={imgClassName} />
    </Link>
  );
}

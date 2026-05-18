import chalk from "chalk";

export type StyleFn = (value: string) => string;

export const theme = {
  title: chalk.hex("#F1EDE7").bold,
  text: chalk.hex("#E8E4DE"),
  muted: chalk.hex("#8A8480"),
  faint: chalk.hex("#5A5550"),
  brand: chalk.hex("#D4935E"),
  link: chalk.hex("#7AB7C6").underline,
  linkText: chalk.hex("#7AB7C6"),
  success: chalk.hex("#63B486"),
  successBold: chalk.hex("#63B486").bold,
  gold: chalk.hex("#D6B56D"),
  goldBold: chalk.hex("#D6B56D").bold,
  silver: chalk.hex("#AEB7BF"),
  silverBold: chalk.hex("#AEB7BF").bold,
  bronze: chalk.hex("#C58A61"),
  bronzeBold: chalk.hex("#C58A61"),
  warning: chalk.hex("#D4A85C"),
  warningBold: chalk.hex("#D4A85C").bold,
  danger: chalk.hex("#D26A6A"),
};

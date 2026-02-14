export interface InkTheme {
  name: string;
  id: string;
  colors: {
    text: string;
    textMuted: string;
    textStrong: string;
    background: string;
    backgroundPanel: string;
    backgroundElement: string;
    border: string;
    borderActive: string;
    borderSubtle: string;
    primary: string;
    primaryMuted: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    diffAdd: string;
    diffRemove: string;
    syntaxString: string;
    syntaxKeyword: string;
    syntaxComment: string;
  };
}

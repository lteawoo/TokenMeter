cask "tokenmeter" do
  version "0.1.6"
  sha256 "3f4201ae8e1658ab43bf28f1fcd17090ac77e73ff9271da66121c0bee5048e8c"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end

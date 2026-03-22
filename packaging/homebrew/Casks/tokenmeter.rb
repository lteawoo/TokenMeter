cask "tokenmeter" do
  version "0.1.2"
  sha256 "64f333a1d89081d039f5b7e4318080ac147c0e2361ee2c4449a56913d377d82d"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end

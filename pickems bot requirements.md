PicksBot: A Discord bot offering ways for servers to hold competitions to see who can get the most NFL picks right during the season.

Background: My friends and I play a game around NFL picks that works like this: every week, we look at the gambling odds of each game \- the over/under point total, and the point spreads. Each player must pick 1 game that they think will hit the over, 1 game they think will hit the under, 1 favorite and 1 underdog that will cover the point spread.

Problem: The entire game is run through a spreadsheet. Every week we must manually pull the next week’s game information, update the spreadsheet, and then we must all manually go into the spreadsheet and make all of our picks for the week. This is tedious, and given that there are 18 weeks in the NFL season this is 18 weeks worth of tedious repeated work. 

Solution: Replace the spreadsheet with a Discord bot. The bot will:

1. Automatically retrieve over/under and point spreads from a specified website  
2. Notify participating users that the picks are available to be made for that week  
3. Store each user’s picks throughout the season

The proposed game flow during a week of the regular season:  
On Tuesdays at 12pm CT:

1. Bot puts out a message showing the previous week’s results per user in a list from best score to worst  
2. Bot puts out a message showing overall standings of points   
3. Bot retrieves odds from site  
4. Bot tags participating users (via a role assigned to all that wish to participate) with a message (in a channel specifically for use by this bot) that the picks are ready  
5. Bot puts out a message showing the week’s matchups with the O/U and the spreads  
6. Bot puts out 4 messages: 1 for each pick required \- OVER, UNDER, FAVORITE, and UNDERDOG  
7. Users use a dropdown menu embedded in each picks message to select the GAME or TEAM they think will be correct  
   1. For OVER/UNDER you are selecting a game, e.g. TEN vs BAL   
   2. For FAVORITE and UNDERDOG you are selecting an individual team

On Thursdays:

1. Bot will tag any user that has not completed their picks for the week  
   

At any point:

1. Users will get a message from the bot ONLY THEY CAN SEE when they have saved all of their picks for the week.  
2. Once a game has started, a user is not able to change their pick if it involves that specific matchup for over/under picks, or one of the teams in the game for favorite/underdog. If a player has not made all 4 of their picks, then a game that has been started cannot be picked (e.g. if the Thursday night game has started and a user hasn’t made their picks, they can still make their picks but can’t pick the matchup or the teams in that game).

Message design:

1. Weekly schedule message  
   1. it should be in a neatly formatted message utilizing icons of each team in each matchup.  
   2. It should list it in this format, where X represents the team’s icon as an emoji:  
      Away team @ Home Team | Over/Under | Favorite point spread  
      example:  
      X Ravens @ Dolphins X | O/U: 46.5 | BAL \-7

      Bold the home team in the point spread, example:  
      X Jets @ Patriots X | O/U: 43.5 | **NE \-9.5**  
   3. Each matchup should have a separate line   
   4. Bye weeks should be listed at the bottom with team name and associated icon as an emoji, example:  
      Byes: Lions X, Bears X, Cardinals X, Chargers X  
2. Picks messages  
   1. Over and Under messages  
      1. The message will say “Please select a matchup that you think will hit the \[OVER/UNDER\]\!”  
      2. The message will have a dropdown menu embedded in it with all of the matchups listed in the format, with an X representing the icon for each team as an emoji:  
         X Away Team @ Home Team X  
      3. Once a user has selected a pick, they should get a message ONLY THEY CAN SEE that says their pick has been saved.  
   2. Favorite and Underdog messages  
      1. The message will say “Please select a \[FAVORITE/UNDERDOG\] that will cover the spread this week\!”  
      2. The message will have a dropdown menu embedded in it with all of the \[FAVORITES/UNDERDOGS\] with their team icons next to them in the list, along with the spread. Example:  
         X Vikings \+7.5 @ LionsX

         Home team again bolded, example:  
         X Cardinals \-7.5 @ **Bears** X  
      3. For FAVORITES, it will show the point spread of the favorite, example:  
         X Cardinals \-7.5 @ **Bears** X  
      4. For UNDERDOGS, it will show the point spread of the underdog, example:  
         X **Bears** \+7.5 vs Cardinals X   
3. Weekly Recap Message  
   1. Essentially the same as the weekly picks message with the correct results bolded, in the format of: X WINNER \#\# \- \#\# LOSER X | \[+/-\]\#\# | TEAM \[+/-\]\#\#, where the \#\# represents winning team’s score, losing team’s score, projected over/under with the corresponding sign depending on if the over or under was hit, projected point spread of favorite/underdog depending on which team covered their spread.

      Example \- ARI vs BAL was \+/- 46.5, with ARI being a favorite of \-7.5, final score was ARI 37 BAL 21, this would show as:  
      X **ARI 37** \- 21 BAL X | \+46.5 | ARI \-7.5   
   2. Include teams on their bye weeks again  
4. Weekly results message  
   1. Since there are only 5 outcomes (4-0, 3-1, 2-2, 1-3, 0-4), output a list showing who got each score. Example:  
      Last week’s results:  
      4-0: USER1, USER2  
      3-1: USER3  
      2-2: USER4, USER7  
      1-3: USER5  
      0-4: USER6  
      1. Omit any scores that aren’t achieved, e.g. if no one went 0-4 don’t show that in the message  
5. Weekly standings message  
   1. Output a list of the overall standings that shows each player’s cumulative picks record, in order from best to worst. Example:  
      🥇 User1 \- 15-4  
      🥈 User2 \- 13-6  
      🥉 User3 \- 10-9  
      User4 \- 5-14  
   2. Only show a maximum of 6 users in this message.  
      1. If there are more than 6 users, show spots 1-3, the middle of the pack, and the bottom 2 users.

Design considerations:
1. This bot will be running on a Raspberry Pi 5 server with 4GB RAM hooked up to the internet and will initially serve at most 3 different Discord servers.
